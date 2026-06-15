// Service worker: cache-first for game assets under /assets/**.
//
// The up-front asset preloader (src/engine/assetPreloader.js) downloads the
// whole fight asset set once. This SW stores those responses in the Cache API
// so a PAGE RELOAD serves them straight from cache — no re-download, just a
// fast in-memory GPU re-warm. Only same-origin /assets GETs are handled;
// everything else (HTML, JS, API) goes straight to the network.
//
// Bump CACHE_NAME whenever assets change to evict the old set on next activate.

const CACHE_NAME = 'pk-assets-v1';
const ASSET_PREFIX = '/assets/';

self.addEventListener('install', () => {
  // Take over as soon as installed — no waiting for old SW to be released.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(ASSET_PREFIX)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache only complete, OK responses. Skip 206 partials (Range requests)
      // and opaque cross-origin responses to avoid storing broken bytes.
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Offline and nothing cached — let the request fail as it normally would.
      const fallback = await cache.match(req);
      if (fallback) return fallback;
      throw err;
    }
  })());
});
