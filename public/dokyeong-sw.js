const CACHE = "dokyeong-live-shell-v3";
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/dokyeong-live", "/dokyeong-icon.svg"]))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dokyeong-live-") && key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/") || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/dokyeong-live")));
});
