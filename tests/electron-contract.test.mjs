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
  assert.match(main, /protocol\.handle\(APP_SCHEME, serveLocalApp\)/);
  assert.match(main, /path\.relative\(root, candidate\)/);
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
  assert.match(main, /taiba:\/\/app\//);
  assert.doesNotMatch(main, /github\.io\/teba-labs/);
});
