import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('shared appearance controller is loaded by all main product and platform pages', () => {
  const pages = [
    'app/index.html', 'app/reception.html', 'app/results-workbench.html',
    'app/catalog.html', 'app/workday.html', 'app/sync-center.html',
    'app/dashboard.html', 'app/settings.html', 'app/cms-editor.html',
    'app/data-import.html', 'app/platform-admin.html', 'portal/index.html'
  ];
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /theme-controller\.js/, file);
    assert.match(html, /keyboard-navigation\.js/, file);
  }
  const worker = read('service-worker.js');
  assert.match(worker, /theme-controller\.js/);
  assert.match(worker, /theme-system\.css/);
});

test('theme controller supports a global default and independent page overrides', () => {
  const script = read('assets/js/theme-controller.js');
  assert.match(script, /taiba\.appearance\.global/);
  assert.match(script, /taiba\.appearance\.page:/);
  assert.match(script, /taiba\.appearance\.scope:/);
  assert.match(script, /clearPageOverrides/);
  assert.match(script, /data-theme/);
  assert.match(script, /theme-system\.css/);
  assert.ok(script.includes("location.pathname.replace(/\\/+$/, '')"));
});

test('keyboard navigation submits the final login field and preserves native search and select behavior', () => {
  const script = read('modules/ui/keyboard-navigation.js');
  assert.match(script, /form\.requestSubmit\(submit\)/);
  assert.match(script, /ArrowDown/);
  assert.match(script, /ArrowUp/);
  assert.doesNotMatch(script, /target\.matches\([^\n]*select/);
});

test('tenant branding keeps the product identity separate from the laboratory name', () => {
  const script = read('assets/js/tenant-branding.js');
  assert.match(script, /TAIBA SMART LAB/);
  assert.match(script, /tenantLabName/);
  const home = read('app/index.html');
  assert.match(home, /TAIBA TECH/);
  assert.match(home, /TAIBA SMART LAB/);
  const platform = read('app/platform-admin.html');
  assert.match(platform, /TAIBA TECH/);
  assert.match(platform, /theme-controller\.js/);
});

test('clinical result entry clearly identifies cloud-only save and approval boundaries while keeping atomic tenant-scoped writes', () => {
  const ui = read('assets/js/results-workbench.js');
  const repository = read('modules/results/repository.js');
  assert.match(ui, /requireCloudConnection\('حفظ النتائج'\)/);
  assert.match(ui, /requireCloudConnection\('اعتماد الزيارة'\)/);
  assert.match(ui, /معاينة التقرير تحتاج اتصالًا بالإنترنت/);
  assert.match(ui, /Save as PDF/);
  assert.match(ui, /ملف PDF النهائي للنشر/);
  assert.match(repository, /save_draft_results_atomic/);
  assert.match(repository, /p_tenant_id: tenantId/);
  assert.doesNotMatch(repository, /enqueueOperation/);
});
