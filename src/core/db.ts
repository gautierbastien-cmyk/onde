/**
 * Petite couche IndexedDB sans dépendance.
 * Magasins : stations, playlists, tracks (historique musical) et kv (préférences,
 * favoris, ordre personnalisé, historique radio, dernière station, cache de pochettes).
 */

const DB_NAME = 'onde';
const DB_VERSION = 1;

export type StoreName = 'stations' | 'playlists' | 'tracks' | 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('stations')) db.createObjectStore('stations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('identifiedAt', 'identifiedAt');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Safari peut fermer la base en arrière-plan : on rouvrira à la demande.
      db.onclose = () => (dbPromise = null);
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return result(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  return done(tx);
}

export async function putMany(store: StoreName, values: unknown[]): Promise<void> {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function remove(store: StoreName, keys: IDBValidKey | IDBValidKey[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of Array.isArray(keys) ? keys : [keys]) os.delete(k);
  return done(tx);
}

export async function clear(store: StoreName): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

/** Demande au navigateur de ne pas évincer les données (Safari l'accorde aux PWA installées). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
