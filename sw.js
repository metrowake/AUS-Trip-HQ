const CACHE = "aus-trip-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./places.js",
  "./trip.json",
  "./itinerary.json",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null))))
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  e.respondWith(
    fetch(req).then((res) => {
      // cache same-origin successful GETs
      try{
        if (req.method === "GET" && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
      }catch(_){}
      return res;
    }).catch(() => caches.match(req))
  );
});
