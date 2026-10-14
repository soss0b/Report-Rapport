// Service worker : met en cache les fichiers statiques et affiche une page
// hors ligne quand le réseau est indisponible. Les données (rapports) ne sont
// jamais mises en cache.
const CACHE = 'rapports-v1';
const ASSETS = [
  '/css/style.css',
  '/js/app.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (ASSETS.includes(new URL(request.url).pathname)) {
    // Réseau d'abord pour avoir la dernière version, cache en secours.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
