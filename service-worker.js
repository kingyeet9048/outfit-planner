// Service worker with a proper update path.
//
// Strategy:
//   • Navigations (the HTML document) → network-first, falling back to cache.
//     Keeps the entry point fresh when online, still works offline.
//   • Same-origin static assets (JS/CSS/icons) → stale-while-revalidate: serve
//     the cached copy instantly, then refresh it in the background for next time.
//     The assets aren't content-hashed, so plain cache-first never refreshes
//     them — SWR is what lets new code actually propagate.
//   • A new version does NOT auto-activate. It waits, the page notices, and the
//     user is offered a one-tap reload (see js/update.js). The page tells us to
//     take over by posting { type: 'SKIP_WAITING' }.
//
// Bump CACHE_NAME on any shell change.
const CACHE_NAME = 'outfit-planner-v11';
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
  './js/update.js',
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
  // Precache the shell, but do NOT skipWaiting — let the new worker wait until
  // the user accepts the update (or all old tabs close).
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks us to activate immediately (user tapped "Reload to update").
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNavigation(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Network-first for navigations so a new deploy's HTML is picked up promptly.
  if (isNavigation(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match('./index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(fresh => {
      if (fresh && fresh.status === 200) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
