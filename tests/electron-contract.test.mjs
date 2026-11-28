import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('desktop package builds a Windows NSIS installer with local app files', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.equal(pkg.build.asar, true);
  assert.ok(pkg.build.win.target.some(item => item.target === 'nsis'));
  assert.ok(pkg.build.files.includes('**/*'));
  assert.match(pkg.scripts['build:win'], /electron-builder/);
});

test('Electron renderer is isolated and sandboxed', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.ok(main.includes('allowServiceWorkers: true'));
  assert.match(main, /protocol\.handle\(APP_SCHEME, serveLocalApp\)/);
  assert.match(main, /path\.relative\(root, candidate\)/);
  assert.ok(main.includes('await fs.realpath(appRoot())'));
  assert.ok(main.includes('await fs.realpath(filePath)'));
  assert.ok(main.includes('!isInsideRoot(realPath, root)'));
  assert.ok(main.includes('!isInsideRoot(resolved, root)'));
  assert.match(main, /setPermissionRequestHandler[\s\S]*callback\(false\)/);
});

test('desktop preload exposes no privileged desktop APIs', async () => {
  const preload = await read('electron/preload.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /ipcRenderer|require\(['"]node:fs|shell\./);
});

test('primary Supabase target remains the existing SaaS project', async () => {
  const env = await read('config/environment.js');
  assert.match(env, /https:\/\/hgqwpykeazuzceeiumjg\.supabase\.co/);
  assert.match(env, /PRIMARY_PROJECT_REF = 'hgqwpykeazuzceeiumjg'/);
  assert.doesNotMatch(env, /khjzoleiuiipyodpkieg/);
});

test('desktop runtime opens the local workspace rather than GitHub Pages', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /APP_SCHEME.*APP_HOST/);
  assert.doesNotMatch(main, /github\.io\/teba-labs/);
});


test('web workspace exposes an installable PWA manifest and local app icons', async () => {
  const html = await read('app/index.html');
  const manifest = JSON.parse(await read('app/manifest.webmanifest'));
  const worker = await read('service-worker.js');
  assert.ok(html.includes('rel="manifest" href="./manifest.webmanifest"'));
  assert.ok(html.includes('rel="apple-touch-icon" href="data:image/png;base64,'));
  assert.equal(manifest.name, 'Taiba Smart Lab');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.src === './icons/icon-192.svg' && icon.sizes === 'any'));
  assert.ok(manifest.icons.some(icon => icon.src === './icons/icon-512.svg' && icon.sizes === 'any'));
  assert.match(worker, /taiba-smart-lab-shell-v106/);
  assert.ok(worker.includes('const REQUIRED_APP_SHELL = ['));
  assert.ok(worker.includes('await cache.addAll(REQUIRED_APP_SHELL)'));
  assert.ok(worker.includes('Promise.allSettled(APP_SHELL.filter'));
  assert.ok(worker.includes("'./app/manifest.webmanifest'"));
  assert.ok(worker.includes("'./assets/js/results-workbench.js?v=visit-results-management-20261128-cas-v1'"));
  const requiredShell = worker.split('const REQUIRED_APP_SHELL = [')[1]?.split('];')[0] || '';
  assert.ok(requiredShell.includes("'./assets/js/results-workbench.js?v=visit-results-management-20261128-cas-v1'"));
});

test('core app entry and primary styles do not require Google-hosted fonts', async () => {
  const html = await read('app/index.html');
  const reception = await read('app/reception.html');
  const styles = await Promise.all(['assets/css/app-home.css','assets/css/reception.css','assets/css/settings-center.css','assets/css/data-import.css'].map(read));
  assert.doesNotMatch(html + reception + styles.join('\\n'), /fonts.googleapis.com|fonts.gstatic.com|Cairo/i);
});


test('responsive shell protects mobile viewport and keeps wide tables locally scrollable', async () => {
  const css = await read('assets/css/app-viewport.css');
  assert.match(css, /min-width:320px/);
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /max-width:767px/);
  assert.match(css, /max-width:420px/);
});

test('primary workflow pages declare device-width viewports', async () => {
  const pages = await Promise.all(['app/index.html','app/reception.html','app/workday.html','app/results-workbench.html','app/result-entry.html','app/sync-center.html','app/catalog.html','app/dashboard.html','app/settings.html','app/cms-editor.html','app/site-management.html','app/site-preview.html','app/data-import.html','app/platform-admin.html','portal/index.html'].map(read));
  for (const html of pages) assert.match(html, /name="viewport"[^>]*content="width=device-width/);
});

test('local protocol rejects traversal and non-read methods before file access', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /request\.method !== 'GET' && request\.method !== 'HEAD'/);
  assert.match(main, /path\.resolve\(root, '\.' \+ pathname\)/);
  assert.match(main, /!isInsideRoot\(filePath, root\)/);
  assert.match(main, /return new Response\('Forbidden', \{ status: 403 \}\)/);
});

test('external navigation is allow-listed and embedded webviews are blocked', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /url\.protocol === 'https:' \|\| url\.protocol === 'mailto:' \|\| url\.protocol === 'tel:'/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-redirect/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /event\.preventDefault\(\)/);
});

test('desktop window keeps renderer security boundaries enabled', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /allowRunningInsecureContent:\s*false/);
  assert.match(main, /webviewTag:\s*false/);
  assert.match(main, /setPermissionCheckHandler\(\(\) => false\)/);
});

test('Electron desktop uses the requested runtime and GitHub update feed', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.devDependencies.electron, '45.5.0');
  assert.ok(pkg.dependencies['electron-updater']);
  assert.ok(pkg.build.publish.some(item => item.provider === 'github' && item.owner === 'teba-labs' && item.repo === 'teba-saas-demo'));
});

test('desktop updates are checked periodically and require user approval', async () => {
  const main = await read('electron/main.cjs');
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(main, /buttons: \['تنزيل التحديث', 'لاحقًا'\]/);
  assert.match(main, /buttons: \['إعادة التشغيل والتحديث', 'لاحقًا'\]/);
  assert.match(main, /autoUpdater\.downloadUpdate\(\)/);
  assert.match(main, /autoUpdater\.quitAndInstall\(\)/);
  assert.match(main, /UPDATE_CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/);
});
