/* AllAroundMe service worker — caches the app shell only (works installed as a
   PWA or straight from the web). API and map data are always network-first;
   no personal data is ever cached. */
/* Bumped to v3: the shell gained theme.js + splash.js and the brand icons, and a
   cache still holding an older list would serve an index.html whose scripts and
   icons 404 offline. */
const SHELL = 'aam-shell-v3';
const ASSETS = ['/', '/index.html', '/reviews.html', '/css/app.css', '/js/i18n.js', '/js/theme.js',
  '/js/app.js', '/js/splash.js', '/js/sound.js', '/js/fx.js', '/manifest.webmanifest',
  '/favicon.ico', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-180.png', '/icons/icon-maskable-512.png',
  /* The default theme's own files: without them a cold offline start has no brand
     to open with and silently drops the open screen. */
  '/themes/allaroundme/theme.json', '/themes/canabolabs/theme.json',
  '/themes/allaroundme/assets/open-screen.png', '/animations/simplefade1.json'];

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
