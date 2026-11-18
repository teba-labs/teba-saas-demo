/* =====================================================
   TEBA LABS - Service Worker (v150 - Smart Offline PC)
   ===================================================== */

const CACHE_VERSION = 'v150'; 
const STATIC_CACHE  = `teba-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `teba-runtime-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './', './index.html', 
  './system/home.html', './system/reception.html', './system/lab.html', './system/tests_manage.html', './system/settings.html',
  './system/lab.css', './system/lab.js', './system/config.js', 
  './dashboard/admin.html', './dashboard/admin.css', './dashboard/admin.js', './dashboard/config.js',
  './styles.css', './data.js', './app.js', './features.js', './site_dynamic.js', './patient_portal.js', './config.js', './super-admin.html',
  './logo.png', './brand-logo.png', './header.png', './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return Promise.all(
        PRECACHE_ASSETS.map(url => {
          return cache.add(url).catch(err => console.warn('Precache fail:', url, err));
        })
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            if (cached) return cached;
            return caches.match('./system/home.html') || caches.match('./index.html');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
        }
        return networkResponse;
      }).catch(() => {});

      return cachedResponse || fetchPromise;
    })
  );
});