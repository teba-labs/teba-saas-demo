const CACHE_NAME = 'taiba-smart-lab-shell-v36';
const APP_SHELL = [
  './app/index.html', './app/site-preview.html', './website/index.html', './app/catalog.html', './app/reception.html', './app/workday.html', './app/results-workbench.html', './app/sync-center.html',
  './app/dashboard.html', './portal/index.html', './app/cms-editor.html', './app/platform-admin.html', './app/site-management.html', './app/settings.html', './app/data-import.html',
  './assets/css/app-home.css', './assets/css/catalog.css', './assets/css/reception.css', './assets/css/workday.css', './assets/css/results-workbench.css', './assets/css/sync-center.css',
  './assets/css/dashboard.css', './assets/css/theme-system.css', './assets/css/cms-editor.css', './assets/css/platform-admin.css', './assets/css/site-management.css', './assets/css/settings-center.css', './assets/css/data-import.css',
  './assets/js/site-preview.js', './website/public-site-page.js', './assets/js/theme-controller.js', './assets/js/tenant-branding.js', './assets/js/app-home.js', './assets/js/catalog.js', './assets/js/reception.js', './assets/js/workday.js', './assets/js/results-workbench.js', './assets/js/results-workbench-layout.js', './assets/js/sync-center.js',
  './assets/js/dashboard.js', './assets/js/dashboard-history.js', './assets/js/dashboard-financial-import.js', './assets/js/cms-editor.js', './assets/js/platform-admin.js', './assets/js/site-management.js', './assets/js/settings-center.js', './assets/js/data-import.js', './modules/migration/historical-results-repository.js',
  './core/supabase-client.js', './core/auth/session.js', './core/tenant/context.js', './core/tenant/workspace-selection.js', './core/data/schema-contract.js', './config/environment.js',
  './offline/database.js', './offline/outbox.js', './offline/cache.js', './offline/backup.js', './offline/supabase-adapters.js', './offline/background-sync.js',
  './modules/ui/keyboard-navigation.js', './modules/dashboard/financial-import-engine.js', './modules/catalog/repository.js', './modules/results/culture-repository.js', './modules/catalog/formula-engine.js', './modules/migration/workbook-inspector.js', './modules/migration/catalog-importer.js', './modules/migration/price-importer.js', './modules/dashboard/expense-breakdown.js', './modules/dashboard/live-status.js', './modules/files/repository.js', './modules/reception/repository.js', './modules/expenses/repository.js', './modules/laboratory/repository.js',
  './modules/results/repository.js', './modules/reports/repository.js', './modules/settings/repository.js', './modules/settings/assets-repository.js', './modules/settings/audit-repository.js', './modules/settings/cloud-backup-repository.js', './modules/staff/repository.js',
  './modules/workday/repository.js', './dashboard/repository.js', './dashboard/owner-financial-repository.js', './website/cms-repository.js', './website/public-site.js'
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

  if (url.hostname === 'esm.sh' || url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Network-first prevents a stale cached login/auth module or page from
      // overriding a newly deployed release. The cache is an offline fallback.
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const appShell = await cache.match('./app/index.html');
          if (appShell) return appShell;
        }
        throw error;
      }
    })());
  }
});
