const CACHE_NAME = 'calib-eau-v3';   // incrémenté pour forcer la mise à jour
const urlsToCache = [
    '.',
    'index.html',
    'style.css',
    'app.js',
    'manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});
