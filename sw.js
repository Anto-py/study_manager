// Service Worker — Study Protocol Manager (v5 finale)
// Stratégie : Cache First pour assets statiques, Network Only pour données.
// Update prompt si nouvelle version détectée.

const CACHE_NAME = 'study-proto-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './dashboard.js',
  './export.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Installation : mise en cache de tous les fichiers essentiels
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Stratégie cache-first pour assets, network-only pour données
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne pas cacher les requêtes POST ou les URLs externes
  if (event.request.method !== 'GET' || url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cacher les nouvelles ressources statiques
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
