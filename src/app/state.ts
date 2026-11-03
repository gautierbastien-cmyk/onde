/**
 * État global et actions d'Onde. Relie la bibliothèque (IndexedDB), le moteur
 * de lecture, les métadonnées, la reconnaissance et l'interface.
 */
import * as db from '../core/db';
import { createStore } from '../core/store';
import { DEFAULT_PREFERENCES, type ImportReport, type Playlist, type Preferences, type RecentPlay, type Station, type Track } from '../core/types';
import { importPlaylist, ImportError } from '../services/m3u/importer';
import { decodePlaylist } from '../services/m3u/parser';
import { probeStream } from '../services/m3u/probe';
import { RadioPlayer, type PlayerState } from '../services/player/RadioPlayer';
import { MetadataService, type MetadataStatus } from '../services/metadata/MetadataService';
import { MusicRecognitionService } from '../services/recognition/MusicRecognitionService';
import { streamMetadataEngine } from '../services/recognition/engines/streamMetadataEngine';
import { DEFAULT_PLAYLISTS } from '../config';

export interface ImportProgress {
  label: string;
  done: number;
  total: number;
  cancel: () => void;
}

export interface ImportOutcome {
  name: string;
  report?: ImportReport;
  error?: string;
}

export interface AppState {
  ready: boolean;
  stations: Station[];
  byId: Map<string, Station>;
  playlists: Playlist[];
  favorites: string[];
  hidden: string[];
  recents: RecentPlay[];
  tracks: Track[];
  prefs: Preferences;
  lastStationId: string | null;
  player: PlayerState;
  metaStatus: MetadataStatus;
  nowTrack: Track | null;
  queue: string[];
  sleepAt: number | null;
  importProgress: ImportProgress | null;
  toast: { id: number; text: string } | null;
}

export const store = createStore<AppState>({
  ready: false,
  stations: [],
  byId: new Map(),
  playlists: [],
  favorites: [],
  hidden: [],
  recents: [],
  tracks: [],
  prefs: DEFAULT_PREFERENCES,
  lastStationId: null,
  player: { status: 'idle', stationId: null, attempt: 0 },
  metaStatus: { state: 'idle' },
  nowTrack: null,
  queue: [],
  sleepAt: null,
  importProgress: null,
  toast: null,
});

let player: RadioPlayer;
let metadata: MetadataService;
let recognition: MusicRecognitionService;

export const getPlayer = () => player;
export const getRecognition = () => recognition;

const kv = {
  get: <T>(k: string) => db.get<T>('kv', k),
  set: (k: string, v: unknown) => db.put('kv', v, k),
};

// ——— Initialisation ———

export async function init() {
  player = new RadioPlayer();
  metadata = new MetadataService(player.audio);
  recognition = new MusicRecognitionService(
    {
      add: async (t) => {
        store.set((s) => ({ tracks: [t, ...s.tracks] }));
        await db.put('tracks', t);
      },
      last: () => store.get().tracks[0],
    },
    { artworkLookup: () => store.get().prefs.artworkLookup },
  );
  recognition.registerEngine(streamMetadataEngine(metadata, () => store.get().prefs.relayUrl));

  player.setUrlResolver((s) => streamUrl(s.url));
  player.subscribe((p) => {
    const prev = store.get().player;
    store.set({ player: p });
    const st = p.stationId ? store.get().byId.get(p.stationId) : undefined;
    // Les métadonnées ne tournent que pendant l'écoute.
    if (p.stationId !== prev.stationId) recognition.detach();
    if (p.status === 'playing' && st && (prev.status !== 'playing' || prev.stationId !== p.stationId) && prev.status !== 'buffering') {
      recognition.attach({ station: st, streamUrl: streamUrl(st.url), audio: player.audio });
    }
    if (p.status === 'paused' || p.status === 'error' || p.status === 'idle') recognition.detach();
    updateMediaSession();
  });
  metadata.onStatus((m) => store.set({ metaStatus: m }));
  recognition.onCurrent((t) => {
    store.set({ nowTrack: t });
    updateMediaSession();
  });
  setupMediaSession();
  setInterval(checkSleep, 1000);
  player.audio.addEventListener('timeupdate', checkSleep);

  const [stations, playlists, tracks, prefs, favorites, hidden, recents, last] = await Promise.all([
    db.getAll<Station>('stations'),
    db.getAll<Playlist>('playlists'),
    db.getAll<Track>('tracks'),
    kv.get<Preferences>('prefs'),
    kv.get<string[]>('favorites'),
    kv.get<string[]>('hidden'),
    kv.get<RecentPlay[]>('recents'),
    kv.get<string>('lastStation'),
  ]);
  tracks.sort((a, b) => b.identifiedAt - a.identifiedAt);
  playlists.sort((a, b) => a.importedAt - b.importedAt);
  setStations(stations);
  store.set({
    ready: true,
    playlists,
    tracks,
    prefs: { ...DEFAULT_PREFERENCES, ...prefs },
    favorites: favorites ?? [],
    hidden: hidden ?? [],
    recents: recents ?? [],
    lastStationId: last ?? null,
  });
  applyTheme();
  db.requestPersistence();

  // Premier lancement : import automatique des playlists personnelles (config.ts).
  if (!playlists.length && !(await kv.get<boolean>('autoImported'))) {
    await kv.set('autoImported', true);
    for (const p of DEFAULT_PLAYLISTS) {
      const outcome = await importFromUrl(p.url, undefined, p.name);
      if (outcome.report) toast(`${outcome.report.kept} radios importées`);
      else if (outcome.error) toast('Import automatique impossible : vérifiez la connexion');
    }
  }
}

function setStations(stations: Station[]) {
  const sorted = [...stations].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  store.set({ stations: sorted, byId: new Map(sorted.map((s) => [s.id, s])) });
}

/**
 * URL réellement lue. Safari refuse les flux HTTP depuis une app HTTPS :
 * on passe par le relais s'il est configuré, sinon on tente la version HTTPS
 * du même serveur (la plupart des serveurs radio la proposent).
 */
function streamUrl(url: string): string {
  if (!url.startsWith('http:') || location.protocol !== 'https:') return url;
  const { relayUrl, relayStreams } = store.get().prefs;
  if (relayUrl && relayStreams) return `${relayUrl.replace(/\/+$/, '')}/stream?url=${encodeURIComponent(url)}`;
  return 'https:' + url.slice(5);
}

export function toast(text: string) {
  const id = Date.now();
  store.set({ toast: { id, text } });
  setTimeout(() => store.get().toast?.id === id && store.set({ toast: null }), 2600);
}

// ——— Lecture ———

/** À appeler directement depuis un toucher (iOS exige un geste pour démarrer l'audio). */
export function playStation(id: string, queue?: string[]) {
  const s = store.get().byId.get(id);
  if (!s) return;
  if (store.get().player.stationId === id && store.get().player.status !== 'error') {
    player.toggle();
    return;
  }
  player.play({ id: s.id, url: s.url });
  const recents = [{ stationId: id, playedAt: Date.now() }, ...store.get().recents.filter((r) => r.stationId !== id)].slice(0, 60);
  store.set({ recents, lastStationId: id, nowTrack: null, ...(queue ? { queue } : {}) });
  kv.set('recents', recents);
  kv.set('lastStation', id);
}

export function togglePlay() {
  const { player: p, lastStationId } = store.get();
  if (p.stationId) {
    if (p.status === 'error') return playStation(p.stationId);
    return player.toggle();
  }
  if (lastStationId) playStation(lastStationId);
}

function visibleQueue(): string[] {
  const { queue, favorites, stations, hidden } = store.get();
  const base = queue.length ? queue : favorites.length ? favorites : stations.map((s) => s.id);
  return base.filter((id) => !hidden.includes(id) && store.get().byId.has(id));
}

export function skip(delta: 1 | -1) {
  const q = visibleQueue();
  if (!q.length) return;
  const cur = store.get().player.stationId ?? store.get().lastStationId;
  const i = cur ? q.indexOf(cur) : -1;
  const next = q[(i + delta + q.length) % q.length];
  playStation(next);
}

// ——— Minuteur de mise en veille ———

export function setSleepTimer(minutes: number | null) {
  store.set({ sleepAt: minutes ? Date.now() + minutes * 60_000 : null });
  if (minutes) toast(`Arrêt de la lecture dans ${minutes} min`);
}

function checkSleep() {
  const { sleepAt } = store.get();
  if (sleepAt && Date.now() >= sleepAt) {
    store.set({ sleepAt: null });
    player.pause();
  }
}

// ——— Media Session (écran verrouillé, Centre de contrôle, AirPods) ———

function setupMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(a, h);
    } catch {
      /* action non prise en charge */
    }
  };
  set('play', () => togglePlay());
  set('pause', () => player.pause());
  set('stop', () => player.pause());
  set('previoustrack', () => skip(-1));
  set('nexttrack', () => skip(1));
  // Direct : pas d'avance/retour rapide.
  set('seekbackward', null);
  set('seekforward', null);
  set('seekto', null);
}

function updateMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms || typeof MediaMetadata === 'undefined') return;
  const { player: p, nowTrack, byId } = store.get();
  const st = p.stationId ? byId.get(p.stationId) : undefined;
  if (!st) return;
  const art = nowTrack?.artworkUrl ?? st.logo;
  ms.metadata = new MediaMetadata({
    title: nowTrack?.title ?? st.name,
    artist: nowTrack ? (nowTrack.artist ?? st.name) : 'En direct',
    album: nowTrack?.album ?? st.name,
    artwork: art ? [{ src: art, sizes: '512x512' }] : [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
  });
  ms.playbackState = p.status === 'paused' || p.status === 'idle' || p.status === 'error' ? 'paused' : 'playing';
}

// ——— Bibliothèque ———

async function persistImport(playlist: Playlist, stations: Station[], replaced?: Playlist) {
  const existing = new Map(store.get().byId);
  for (const s of stations) existing.set(s.id, s);
  const toDelete: string[] = [];
  const toUpdate: Station[] = [...stations];
  if (replaced) {
    const keep = new Set(playlist.stationIds);
    for (const id of replaced.stationIds) {
      if (keep.has(id)) continue;
      const s = existing.get(id);
      if (!s) continue;
      const ids = s.playlistIds.filter((p) => p !== replaced.id);
      if (ids.length) {
        const u = { ...s, playlistIds: ids };
        existing.set(id, u);
        toUpdate.push(u);
      } else {
        existing.delete(id);
        toDelete.push(id);
      }
    }
  }
  await db.putMany('stations', toUpdate);
  if (toDelete.length) await db.remove('stations', toDelete);
  await db.put('playlists', playlist);
  setStations([...existing.values()]);
  store.set((s) => ({ playlists: [...s.playlists.filter((p) => p.id !== playlist.id), playlist] }));
}

async function runImport(raw: string, name: string, source: Playlist['source'], replace?: Playlist): Promise<ImportOutcome> {
  const ctrl = new AbortController();
  try {
    const res = await importPlaylist({
      name,
      source,
      raw,
      existing: store.get().byId,
      replaceId: replace?.id,
      probe: (url) => probeStream(url),
      signal: ctrl.signal,
      onProgress: (done, total) => store.set({ importProgress: { label: name, done, total, cancel: () => ctrl.abort() } }),
    });
    if (replace) res.playlist.importedAt = replace.importedAt;
    await persistImport(res.playlist, res.stations, replace);
    return { name, report: res.report };
  } catch (e) {
    return { name, error: e instanceof ImportError ? e.message : 'Lecture du fichier impossible : ' + (e as Error).message };
  } finally {
    store.set({ importProgress: null });
  }
}

const baseName = (f: string) => f.replace(/\.(m3u8?|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || f;

export async function importFiles(files: File[], replace?: Playlist): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  for (const f of files) {
    store.set({ importProgress: { label: f.name, done: 0, total: 0, cancel: () => {} } });
    const raw = decodePlaylist(await f.arrayBuffer());
    out.push(await runImport(raw, replace?.name ?? baseName(f.name), { type: 'file', ref: f.name }, replace));
  }
  return out;
}

export async function importFromUrl(url: string, replace?: Playlist, name?: string): Promise<ImportOutcome> {
  store.set({ importProgress: { label: url, done: 0, total: 0, cancel: () => {} } });
  let raw: string;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    raw = decodePlaylist(await res.arrayBuffer());
  } catch (e) {
    store.set({ importProgress: null });
    return { name: url, error: 'Téléchargement impossible (serveur injoignable ou CORS refusé). Enregistrez le fichier puis importez-le depuis Fichiers.' };
  }
  const label = replace?.name ?? name ?? baseName(decodeURIComponent(new URL(url).pathname.split('/').pop() || new URL(url).hostname));
  return runImport(raw, label, { type: 'url', ref: url }, replace);
}

export async function deletePlaylist(p: Playlist) {
  await persistImport({ ...p, stationIds: [] }, [], p);
  await db.remove('playlists', p.id);
  store.set((s) => ({ playlists: s.playlists.filter((x) => x.id !== p.id) }));
  toast(`« ${p.name} » supprimée`);
}

export async function renamePlaylist(p: Playlist, name: string) {
  const u = { ...p, name };
  await db.put('playlists', u);
  store.set((s) => ({ playlists: s.playlists.map((x) => (x.id === p.id ? u : x)) }));
}

export function toggleFavorite(id: string) {
  const favs = store.get().favorites;
  const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
  store.set({ favorites: next });
  kv.set('favorites', next);
  toast(next.length > favs.length ? 'Ajoutée aux favoris' : 'Retirée des favoris');
}

export function reorderFavorites(ids: string[]) {
  store.set({ favorites: ids });
  kv.set('favorites', ids);
}

export function toggleHidden(id: string) {
  const h = store.get().hidden;
  const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
  store.set({ hidden: next });
  kv.set('hidden', next);
  toast(next.length > h.length ? 'Station masquée' : 'Station réaffichée');
}

export async function renameStation(id: string, name: string) {
  const s = store.get().byId.get(id);
  if (!s || !name.trim()) return;
  const u = { ...s, name: name.trim() };
  await db.put('stations', u);
  setStations(store.get().stations.map((x) => (x.id === id ? u : x)));
}

// ——— Historique ———

export async function deleteTracks(ids: string[]) {
  const set = new Set(ids);
  store.set((s) => ({ tracks: s.tracks.filter((t) => !set.has(t.id)) }));
  await db.remove('tracks', ids);
}

export async function clearHistory() {
  store.set({ tracks: [] });
  await db.clear('tracks');
}

export async function clearRecents() {
  store.set({ recents: [] });
  await kv.set('recents', []);
}

// ——— Préférences ———

export function setPrefs(patch: Partial<Preferences>) {
  const prefs = { ...store.get().prefs, ...patch };
  store.set({ prefs });
  kv.set('prefs', prefs);
  if ('theme' in patch) applyTheme();
}

function applyTheme() {
  const t = store.get().prefs.theme;
  document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#050506' : '#f4f4f6');
}

export async function resetAll() {
  player.stop();
  await Promise.all((['stations', 'playlists', 'tracks', 'kv'] as const).map((s) => db.clear(s)));
  location.reload();
}
