/* ============================================================
   VCC Vision Screening App â Service Worker
   Caches everything needed to run fully offline. Bump CACHE_NAME
   whenever app files change so clients pick up the new version;
   the update happens silently the next time a device has WiFi.
   ============================================================ */

const CACHE_NAME = "vcc-vision-v1.1.0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/state.js",
  "./js/optotypes.js",
  "./js/chart.js",
  "./js/app.js",
  "./assets/fonts/Optician-Sans.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Cache-first strategy: instant offline loads. Falls back to the
// network only for anything not yet cached, and silently updates
// the cache in the background whenever a fresher copy is fetched.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
