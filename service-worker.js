const CACHE_NAME = 'taiba-smart-lab-shell-v7';
const APP_SHELL = [
  './app/index.html', './app/catalog.html', './app/reception.html', './app/workday.html', './app/results-workbench.html', './app/sync-center.html',
  './app/dashboard.html', './app/cms-editor.html', './app/platform-admin.html', './app/settings.html', './app/data-import.html',
  './assets/css/app-home.css', './assets/css/catalog.css', './assets/css/reception.css', './assets/css/workday.css', './assets/css/results-workbench.css', './assets/css/sync-center.css',
  './assets/css/dashboard.css', './assets/css/cms-editor.css', './assets/css/platform-admin.css', './assets/css/settings-center.css', './assets/css/data-import.css',
  './assets/js/app-home.js', './assets/js/catalog.js', './assets/js/reception.js', './assets/js/workday.js', './assets/js/results-workbench.js', './assets/js/sync-center.js',
  './assets/js/dashboard.js', './assets/js/cms-editor.js', './assets/js/platform-admin.js', './assets/js/settings-center.js', './assets/js/data-import.js',
  './core/supabase-client.js', './core/auth/session.js', './core/tenant/context.js', './core/tenant/workspace-selection.js', './core/data/schema-contract.js', './config/environment.js',
  './offline/database.js', './offline/outbox.js', './offline/cache.js', './offline/backup.js', './offline/supabase-adapters.js', './offline/background-sync.js',
  './modules/catalog/repository.js', './modules/migration/workbook-inspector.js', './modules/files/repository.js', './modules/reception/repository.js', './modules/expenses/repository.js', './modules/laboratory/repository.js',
  './modules/results/repository.js', './modules/reports/repository.js', './modules/settings/repository.js', './modules/settings/audit-repository.js', './modules/staff/repository.js',
  './modules/workday/repository.js', './dashboard/repository.js', './website/cms-repository.js', './website/public-site.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Warm the top-level ESM dependencies. Their transitive modules are cached on first online use.
    await Promise.all(['https://esm.sh/dexie@4', 'https://esm.sh/@supabase/supabase-js@2'].map(async url => {
      try { const response = await fetch(url); if (response.ok) await cache.put(url, response.clone()); } catch { /* offline-first shell remains installable if CDN is temporarily unavailable */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('taiba-smart-lab-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.endsWith('.supabase.co')) return; // Never cache authenticated API or patient data responses.

  if (url.hostname === 'esm.sh') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(fetch(request).then(response => { if (response.ok) return cache.put(request, response.clone()); }).catch(() => {}));
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(fetch(request).then(response => { if (response.ok) return cache.put(request, response.clone()); }).catch(() => {}));
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok && (request.destination === 'document' || request.destination === 'script' || request.destination === 'style')) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        if (request.mode === 'navigate') return cache.match('./app/index.html');
        throw error;
      }
    })());
  }
});
