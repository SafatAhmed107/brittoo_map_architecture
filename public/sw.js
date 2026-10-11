// Service Worker for Zero-Cost Map Architecture: Offline Precaching
const CACHE_NAME = 'tuition-geo-v7';
const PRECACHE_URLS = [
  '/geo/bd_thanas.min.geojson',
  '/geo/bd_landmarks.json',
  '/geo/districts/manifest.json',
  '/geo/districts/dhaka.json'
];

// Install: Precache critical geo assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches when version bumps
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first with background fill for all /geo/ assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Cache-first for any geo asset (thanas, landmarks, districts, clusters)
  if (url.pathname.startsWith('/geo/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for PMTiles byte-range requests
  if (url.pathname.endsWith('.pmtiles')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }
});
