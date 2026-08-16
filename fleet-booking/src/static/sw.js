/**
 * Service worker — enough to make the site installable, and no more.
 *
 * This app is a booking form talking to an API. It cannot do anything useful
 * offline: a price comes from Google via our Lambda, and a booking has to
 * reach DynamoDB. So this deliberately does NOT try to be an offline app. What
 * it does is make the shell load instantly on a repeat visit, and show the
 * app's own page rather than the browser's dinosaur when the network is gone.
 *
 * Three rules, in order of how much trouble they can cause:
 *
 *   API calls        never touched. A cached quote is a wrong price, and a
 *                    cached booking list is somebody's trip that is not there.
 *                    Cross-origin requests fall straight through.
 *   hashed assets    cache-first. Vite fingerprints them, so a given URL's
 *                    contents can never change — the safest thing to cache and
 *                    the one worth caching most.
 *   navigations      network-first, cache as fallback. index.html is deployed
 *                    with no-cache precisely so a new build is picked up at
 *                    once; serving a stale shell from here would undo that.
 */
/**
 * Replaced at build time with the build's own id (see vite.config.js).
 *
 * This is what makes an update happen at all. A byte-identical sw.js is, to the
 * browser, no update — it never fires `updatefound`, never activates, and never
 * clears the old caches. Stamping the build in means every deploy produces a
 * different worker, which is the signal the whole update flow hangs off.
 */
const VERSION = '__BUILD_ID__';
const SHELL = `fleet-shell-${VERSION}`;
const ASSETS = `fleet-assets-${VERSION}`;
const KEEP = new Set([SHELL, ASSETS]);

/**
 * A new worker waits by default, so it cannot swap the assets under a page that
 * is mid-booking. It takes over only when the page asks — which it does after
 * the customer accepts the update prompt.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  // Warm the shell so the first offline load has something to show.
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/', '/icon-192.png'])).catch(() => {}),
  );
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
  // Anything not served from this origin is the API, Google, or Clerk. None of
  // it belongs in a cache, and a service worker that guesses otherwise breaks
  // sign-in in ways that are very hard to explain.
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

  // Cache-first is only ever safe for a URL whose contents cannot change, and
  // that is exactly the set Vite fingerprints: /assets/index-a1b2c3.js. Anything
  // else keeps a stable name across deploys, so a cached copy is a copy that can
  // go stale for good.
  //
  // The manifest was in here once. A service worker serving it from Cache
  // Storage outranks every HTTP cache header, so the installed app kept reading
  // an old app name — and no amount of fixing headers or redeploying could
  // reach it. The icons had the same problem: icon-192.png is not fingerprinted,
  // so the first one downloaded would have been the only one ever shown.
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
