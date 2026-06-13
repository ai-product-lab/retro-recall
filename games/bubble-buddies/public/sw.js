/**
 * Bubble Buddies service worker (ADR-007). Strategy:
 *  - app shell + static assets: cached, stale-while-revalidate
 *  - navigations: network-first, falling back to the cached shell offline
 *  - room API (/api, /room): network-first, never served stale — a stale
 *    roster is worse than an error (WebSockets bypass the SW entirely)
 * Bump VERSION to invalidate every cache on deploy of a breaking shell.
 */
const VERSION = 'bb-shell-v1';
const SHELL = [
  '/',
  '/play/bubble-buddies/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin (workers.dev rooms origin on preview deploys): hands off.
  if (url.origin !== self.location.origin) return;

  // Room API: always fresh.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/room/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigations: network-first so deploys land, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((hit) => hit ?? caches.match('/', { ignoreSearch: true })),
        ),
    );
    return;
  }

  // Static assets (hashed JS/CSS, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    }),
  );
});
