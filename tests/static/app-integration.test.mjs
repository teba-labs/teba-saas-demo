import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('unified Arabic launcher exists and loads authenticated tenant context', () => {
  const html = read('app/index.html');
  const js = read('assets/js/app-home.js');
  assert.match(html, /lang="ar" dir="rtl"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="tenantSelect"/);
  assert.match(html, /id="branchSelect"/);
  assert.match(js, /loadMyTenantContext/);
  assert.match(js, /getCurrentSession/);
});

test('launcher only exposes financial dashboard and CMS to tenant owners', () => {
  const js = read('assets/js/app-home.js');
  assert.match(js, /href:'dashboard\.html'.*roles:\['owner'\]/);
  assert.match(js, /href:'cms-editor\.html'.*roles:\['owner'\]/);
  assert.match(js, /href:'reception\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /href:'results-workbench\.html'.*roles:\['owner','staff'\]/);
});

test('all tenant and platform screens link back to the launcher', () => {
  for (const page of ['catalog','reception','workday','results-workbench','sync-center','dashboard','cms-editor','platform-admin']) {
    assert.match(read(`app/${page}.html`), /href="index\.html"/, `${page} has no home link`);
  }
});

test('service worker pre-caches all application screens and local assets', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /taiba-smart-lab-shell-v3/);
  const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
  const assets = [...shell.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  assert.ok(assets.includes('app/index.html'));
  assert.ok(assets.includes('app/dashboard.html'));
  assert.ok(assets.includes('app/cms-editor.html'));
  const missing = assets.filter(asset => !fs.existsSync(path.join(root, asset)));
  assert.deepEqual(missing, []);
  assert.match(sw, /hostname\.endsWith\('\.supabase\.co'\)\) return/);
  assert.match(sw, /cache\.match\('\.\/app\/index\.html'\)/);
});
