// Service worker: keeps the app and viewed map tiles available offline.
// build.mjs fills in the version and the list of files to precache below.
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const APP_CACHE = `app-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const TILE_LIMIT = 5000;
const TILE_HOSTS = /(^|\.)basemaps\.cartocdn\.com$|^tile\.openstreetmap\.org$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('app-') && n !== APP_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// The page asks for this after the person taps "Reload" on the update notice.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/__/')) return; // Firebase config and sign-in pages
    if (req.mode === 'navigate') {
      event.respondWith(appShell(req));
      return;
    }
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }
  if (TILE_HOSTS.test(url.hostname)) {
    event.respondWith(tile(req));
  }
  // everything else (Google sign-in, Firestore) goes straight to the network
});

async function appShell(req) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match('/index.html');
  if (cached) return cached;
  try {
    return await fetch(req);
  } catch {
    return new Response('Site Surveyor is offline and not cached yet. Connect once to install it.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).pathname.startsWith('/assets/')) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone());
  }
  return res;
}

let tilePuts = 0;
async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (++tilePuts % 100 === 0) trim(cache);
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - TILE_LIMIT;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
