/**
 * Service worker — the minimum that makes the tracker installable and keeps it
 * updatable. Deliberately not an offline app.
 *
 * This is a dashboard over a DynamoDB table. Every number on it comes from the
 * API, and a cached number is a wrong number — a stale month's revenue shown
 * with no indication that it is stale is worse than an error. So nothing from
 * the API is ever stored, and the only things cached are the files that cannot
 * change behind their own URL.
 *
 *   API and cross-origin   never touched
 *   /assets/*              cache-first. Vite fingerprints these, so a given URL
 *                          always means the same bytes — the only safe thing to
 *                          cache, and the one worth caching.
 *   navigations            network-first, with the last shell as a fallback so
 *                          an offline launch shows the app's own page rather
 *                          than the browser's error.
 *
 * Everything else — the manifest, the icons — goes to the network every time.
 * They keep stable filenames, so a cached copy is one that can go stale for
 * good: that is how an installed app ends up stuck on an old name or icon with
 * no way to fix it from the server.
 */
const VERSION = '__BUILD_ID__';
const SHELL = `tracker-shell-${VERSION}`;
const ASSETS = `tracker-assets-${VERSION}`;
const KEEP = new Set([SHELL, ASSETS]);

/**
 * A new worker waits rather than seizing the page, so a half-typed daily entry
 * never has its JavaScript swapped underneath it. It takes over when the page
 * asks, which happens after the update prompt is accepted.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      ),
    );
  }
});
