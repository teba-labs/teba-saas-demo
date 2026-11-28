const CACHE_NAME = 'taiba-smart-lab-shell-v106';
const APP_SHELL = [
  './app/manifest.webmanifest', './app/icons/icon-192.svg', './app/icons/icon-512.svg',
  './app/index.html', './app/site-preview.html', './website/index.html', './website/site.css', './website/public-site-ui.js', './app/catalog.html', './app/reception.html', './app/workday.html', './app/results-workbench.html', './app/result-entry.html', './app/sync-center.html',
  './app/dashboard.html', './portal/index.html', './app/cms-editor.html', './app/platform-admin.html', './app/site-management.html', './app/settings.html', './app/data-import.html',
  './assets/css/app-viewport.css', './assets/css/app-home.css', './assets/css/catalog.css', './assets/css/reception.css', './assets/css/workday.css', './assets/css/results-workbench.css', './assets/css/sync-center.css',
  './assets/css/dashboard.css', './assets/css/theme-system.css', './assets/css/cms-editor.css', './assets/css/platform-admin.css', './assets/css/site-management.css', './assets/css/settings-center.css', './assets/css/data-import.css',
  './assets/js/site-preview.js', './website/public-site-page.js', './assets/js/theme-controller.js', './assets/js/tenant-branding.js', './assets/js/app-home.js', './assets/js/catalog.js', './assets/js/reception.js', './assets/js/reception-visit-history.js', './assets/js/workday.js', './assets/js/results-workbench.js', './assets/js/results-workbench-layout.js', './portal/lookup.js', './assets/js/sync-center.js',
  './assets/css/app-home.css?v=progressive-20261126-v2', './assets/js/app-home.js?v=progressive-20261126-v2',
  './assets/css/catalog.css?v=catalog-workspace-20261126-v2', './assets/js/catalog.js?v=catalog-workspace-20261126-v2',
  './assets/js/catalog.js?v=catalog-ops-20261126-v1',
  './assets/js/results-workbench.js?v=visit-results-management-20261128-cas-v1',
  './assets/css/dashboard.css?v=dashboard-workspace-20261126-v2', './assets/js/dashboard.js?v=dashboard-workspace-20261126-v2',
  './assets/css/reception.css?v=reception-workspace-20261126-v2', './assets/js/reception.js?v=visit-management-20261127-v2', './assets/js/reception-visit-history.js?v=visit-management-20261127-v3',
  './assets/css/results-workbench.css?v=results-workspace-20261126-v2', './assets/js/results-workbench-layout.js?v=visit-results-management-20261127-v5',
  './assets/css/site-management.css?v=portal-sidebar-20261126', './assets/js/site-management.js?v=portal-sidebar-20261126',
  './assets/js/dashboard.js', './assets/js/dashboard-history.js', './assets/js/dashboard-financial-import.js', './assets/js/cms-editor.js', './assets/js/platform-admin.js', './assets/js/site-management.js', './assets/js/settings-center.js', './assets/js/data-import.js', './modules/migration/historical-results-repository.js',
  './core/supabase-client.js', './core/auth/session.js', './core/tenant/context.js', './core/tenant/workspace-selection.js', './core/data/schema-contract.js', './config/environment.js',
  './offline/database.js', './offline/outbox.js', './offline/cache.js', './offline/backup.js', './offline/supabase-adapters.js', './offline/background-sync.js', './offline/prepare.js',
  './offline/device-identity.js', './offline/entitlement.js', './offline/entitlement-public-key.js', './offline/queue-policy.js', './offline/result-fingerprint.js', './offline/dashboard-summary.js',
  './modules/ui/keyboard-navigation.js', './modules/dashboard/financial-import-engine.js', './modules/catalog/repository.js', './modules/results/culture-repository.js', './modules/catalog/formula-engine.js', './modules/migration/workbook-inspector.js', './modules/migration/catalog-importer.js', './modules/migration/price-importer.js', './modules/dashboard/expense-breakdown.js', './modules/dashboard/live-status.js', './modules/files/repository.js', './modules/reception/repository.js', './modules/reception/visit-management-repository.js', './modules/expenses/repository.js', './modules/laboratory/repository.js',
  './modules/results/repository.js', './modules/results/historical-display.js', './modules/results/input-mode.js', './modules/reports/repository.js', './modules/settings/repository.js', './modules/settings/assets-repository.js', './modules/settings/audit-repository.js', './modules/settings/cloud-backup-repository.js', './modules/staff/repository.js',
  './modules/workday/repository.js', './dashboard/repository.js', './dashboard/owner-financial-repository.js', './website/cms-repository.js', './website/public-site.js'
];

const REQUIRED_APP_SHELL = [
  './app/index.html', './app/reception.html', './app/manifest.webmanifest',
  './app/icons/icon-192.svg', './app/icons/icon-512.svg',
  './assets/js/reception.js', './assets/js/results-workbench.js',
  './assets/js/results-workbench.js?v=visit-results-management-20261128-cas-v1',
  './assets/js/sync-center.js', './modules/ui/keyboard-navigation.js',
  './core/supabase-client.js', './offline/database.js', './offline/outbox.js',
  './offline/supabase-adapters.js'
];

async function cacheOptionalShellAsset(cache, asset) {
  // Cache.add resolves paths against the service worker scope.
  await cache.add(asset);
}

async function fetchWithTimeout(request, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(request, { signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Essential workflow files and local icons gate installation. Optional
    // pages/assets are cached independently so one stale URL cannot prevent
    // the complete application shell from installing.
    await cache.addAll(REQUIRED_APP_SHELL);
    const required = new Set(REQUIRED_APP_SHELL);
    await Promise.allSettled(APP_SHELL.filter(asset => !required.has(asset)).map(asset => cacheOptionalShellAsset(cache, asset)));
    await Promise.all(['https://esm.sh/dexie@4', 'https://esm.sh/@supabase/supabase-js@2'].map(async url => {
      try { const response = await fetch(url); if (response.ok) await cache.put(url, response.clone()); } catch { /* shell remains installable */ }
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
      try {
        const response = await fetchWithTimeout(request);
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
