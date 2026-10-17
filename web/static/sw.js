// Cache strategy changed in this revision — bump the name so old caches are
// dropped rather than mixing a cache-first fetch handler with a stale shell.
const CACHE_NAME = 'nido-v2';
const SHELL_ASSETS = [
  '/',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/robots.txt',
];

// Install event - cache the static app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch event. Only same-origin GET requests are considered; everything else
// (the API, cross-origin, non-GET) passes straight through untransformed.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Don't cache API calls.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Content-hashed build output (`/_app/immutable/*`): the filename changes
  // whenever the content does, so cache-first forever is safe and the fresh
  // HTML we serve on navigation points at the new hashes.
  if (url.pathname.startsWith('/_app/immutable/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — page navigations, the version.json SvelteKit polls to
  // detect a new deploy, and other non-hashed assets — is network-first with a
  // cache fallback. This is what stops the client holding onto stale layout
  // data after a deploy: every load revalidates against the server.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});