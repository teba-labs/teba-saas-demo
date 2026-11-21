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
  assert.match(html, /id="workdayTitle"/);
  assert.match(html, /id="ownerArea"/);
  assert.match(html, /assets\/js\/tenant-branding\.js/);
  assert.match(js, /loadMyTenantContext/);
  assert.match(js, /getCurrentSession/);
  assert.match(js, /getCurrentWorkday/);
  assert.match(js, /getOutboxSummary/);
});

test('launcher exposes core operations to staff and reserves owner controls', () => {
  const js = read('assets/js/app-home.js');
  assert.match(js, /href:'dashboard\.html'.*roles:\['owner'\]/);
  assert.match(js, /href:'reception\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /href:'catalog\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /href:'results-workbench\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /href:'workday\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /href:'sync-center\.html'.*roles:\['owner','staff'\]/);
  assert.match(js, /\$\('ownerArea'\)\.hidden = role !== 'owner'/);
  const html = read('app/index.html');
  assert.match(html, /إعدادات النظام/);
  assert.match(html, /إدارة موقع المعمل/);
  assert.match(html, /href="\.\.\/portal\/index\.html"/);
  assert.match(html, /معاينة بوابة المريض/);
});

test('launcher provides a responsive medical workspace and live operational status', () => {
  const html = read('app/index.html');
  const css = read('assets/css/app-home.css');
  const js = read('assets/js/app-home.js');
  assert.match(html, /class="workday-overview"/);
  assert.match(html, /class="system-status"/);
  assert.match(html, /class="owner-links"/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /--teal:/);
  assert.match(js, /يوم العمل مفتوح/);
  assert.match(js, /لا توجد عمليات معلقة/);
  assert.match(js, /قيد التنفيذ/);
});

test('all tenant and platform screens link back to the launcher', () => {
  for (const page of ['catalog','reception','workday','results-workbench','sync-center','dashboard','cms-editor','platform-admin']) {
    assert.match(read(`app/${page}.html`), /href="index\.html"/, `${page} has no home link`);
  }
});

test('service worker pre-caches all application screens and local assets', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /taiba-smart-lab-shell-v\\d+/);
  const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
  const assets = [...shell.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  assert.ok(assets.includes('app/index.html'));
  assert.ok(assets.includes('app/dashboard.html'));
  assert.ok(assets.includes('app/cms-editor.html'));
  assert.ok(assets.includes('assets/css/app-home.css'));
  assert.ok(assets.includes('assets/js/app-home.js'));
  assert.ok(assets.includes('assets/js/tenant-branding.js'));
  const missing = assets.filter(asset => !fs.existsSync(path.join(root, asset)));
  assert.deepEqual(missing, []);
  assert.match(sw, /hostname\.endsWith\('\.supabase\.co'\)\) return/);
  assert.match(sw, /cache\.match\('\.\/app\/index\.html'\)/);
});
