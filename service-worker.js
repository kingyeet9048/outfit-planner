// Cache-first app shell SW. Bump CACHE_NAME on any shell change.
const CACHE_NAME = 'outfit-planner-v9';
const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './css/reset.css',
  './css/app.css',
  './js/app.js',
  './js/router.js',
  './js/ui.js',
  './js/db.js',
  './js/store.js',
  './js/image.js',
  './js/exporter.js',
  './js/share.js',
  './js/storage.js',
  './js/backup.js',
  './js/vendor/idb.js',
  './js/components/nav.js',
  './js/components/outfit-stack.js',
  './js/components/picker.js',
  './js/components/storage-banner.js',
  './js/components/backup-prompts.js',
  './js/views/items.js',
  './js/views/item-view.js',
  './js/views/item-editor.js',
  './js/views/outfits.js',
  './js/views/outfit-view.js',
  './js/views/outfit-editor.js',
  './js/views/trips.js',
  './js/views/trip-detail.js',
  './js/views/stylist.js',
  './js/views/settings.js',
  './js/stylist/color.js',
  './js/stylist/intent.js',
  './js/stylist/engine.js',
  './js/stylist/response.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      // Cache successful same-origin GETs as we go
      if (fresh && fresh.status === 200) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // Navigation fallback: return cached app shell
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
