/* Service Worker d'Onde — généré à la compilation (liste des fichiers injectée).
 *
 * - Application : mise en cache complète à l'installation → bibliothèque consultable hors ligne.
 * - Logos et pochettes : cache « stale-while-revalidate », limité en nombre.
 * - Flux radio et requêtes de métadonnées : jamais interceptés (direct uniquement).
 */
const VERSION = '__VERSION__';
const APP_CACHE = `onde-app-${VERSION}`;
const IMG_CACHE = 'onde-images-v1';
const PRECACHE = __PRECACHE__;
const MAX_IMAGES = 600;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('onde-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))]);
    if (res.ok) cache.put('./', res.clone());
    return res;
  } catch {
    return (await cache.match('./')) || (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(APP_CACHE)).put(request, res.clone());
  return res;
}

async function image(request) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      // Réponses « opaques » (logos sans CORS) acceptées : elles s'affichent normalement.
      if (res.ok || res.type === 'opaque') {
        cache.put(request, res.clone()).then(() => trim(IMG_CACHE, MAX_IMAGES));
      }
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  const dest = req.destination;
  if (dest === 'audio' || dest === 'video' || dest === 'track') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') return event.respondWith(networkFirst(req));
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    return event.respondWith(cacheFirst(req));
  }
  if (dest === 'image') return event.respondWith(image(req));
  // Tout le reste (flux, ICY, iTunes…) passe directement par le réseau.
});
