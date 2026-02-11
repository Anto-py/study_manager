// Service Worker — Study Protocol Manager (v4)
// Permet le fonctionnement hors-ligne après la première visite.
// Version 4 : étape 4 — questionnaire chronotype, flashcards, mode révision.

const CACHE_NAME = 'study-proto-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './dashboard.js',
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

// Stratégie cache-first : servir depuis le cache, sinon réseau
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
