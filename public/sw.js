// Hand-written service worker.
//
// Deliberately not vite-plugin-pwa: the Lovable vite config wrapper breaks if
// plugins are added to it, so the cache is managed here instead where nothing
// can collide with the build.
//
// Strategy:
//   * App files (JS/CSS/fonts/images) — cache first, then network. They are
//     content-hashed, so a cached copy is never stale.
//   * Navigations — network first, falling back to the cached shell, so a
//     field officer with no signal still gets a working screen.
//   * Supabase and any other API call — never cached. Stale farm data that
//     looks live is worse than an honest failure; the outbox handles writes.

const CACHE = "fieldwatch-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAsset = (url) =>
  url.origin === self.location.origin &&
  /\.(js|css|woff2?|ttf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never serve API responses from cache.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});
