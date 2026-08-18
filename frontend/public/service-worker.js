// KasirKu Service Worker — cache app shell for offline usage.
// Never caches /api/* requests — API traffic goes through the network so the
// app can detect offline state and fall back to IndexedDB.
const CACHE_NAME = "kasirku-shell-v2";
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept API calls — offline behavior is handled in the app via IndexedDB
  if (url.pathname.startsWith("/api/")) return;
  // Skip external font/image requests to avoid opaque cache bloat
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => caches.match("/index.html"))
    )
  );
});
