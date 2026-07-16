/* AllAroundMe service worker — caches the app shell only (works installed as a
   PWA or straight from the web). API and map data are always network-first;
   no personal data is ever cached. */
const SHELL = 'aam-shell-v1';
const ASSETS = ['/', '/index.html', '/reviews.html', '/css/app.css', '/js/app.js', '/js/sound.js', '/js/fx.js', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // network only
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && ASSETS.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
