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
  assert.match(script, /document\.documentElement\.dataset\.theme/);
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

test('clinical result entry queues drafts and local approval while keeping final publication online-only', () => {
  const ui = read('assets/js/results-workbench.js');
  const repository = read('modules/results/repository.js');
  assert.doesNotMatch(ui, /requireCloudConnection\('حفظ النتائج'\)/);
  assert.doesNotMatch(ui, /requireCloudConnection\('اعتماد الزيارة'\)/);
  assert.doesNotMatch(ui, /approveVisitWithAutoCompletion/);
  assert.match(repository, /entityType:'visit_approval'/);
  assert.match(ui, /نتائج محلية/);
  assert.match(ui, /النشر على بوابة المريض يحتاج اتصالًا/);
  assert.match(ui, /Print work copy — awaiting synchronization/);
  assert.match(ui, /not yet available on the patient portal/);
  assert.match(ui, /reportPreviewHtml\.set/);
  assert.match(ui, /pdf\.output\('blob'\)/);
  assert.match(ui, /\.toPdf\(\)/);
  assert.match(ui, /publishReportVersion/);
  assert.doesNotMatch(ui, /data-report-file/);
  assert.match(repository, /save_draft_results_idempotent/);
  assert.match(repository, /p_tenant_id: tenantId/);
  assert.match(repository, /enqueueOperation/);
  assert.match(ui, /محفوظ محليًا — بانتظار المزامنة/);
});

test('approved report publication and WhatsApp handoff use the private tenant report path and patient portal', () => {
  const reports = read('modules/reports/repository.js');
  const layout = read('assets/js/results-workbench-layout.js');
  const resultsWorkbench = read('assets/js/results-workbench.js');
  assert.match(reports, /functions\\.invoke\\('publish-report'/);
  assert.match(reports, /storage\\.from\\('tenant-reports'\\)/);
  assert.match(resultsWorkbench, /wa\\.me\\//);
  assert.match(resultsWorkbench, /portal\\/index\\.html/);
  assert.match(resultsWorkbench, /sharePublishedReport/);
  assert.match(layout, /record\\.actions\\.forEach/);
});


test('appearance scope switching immediately applies the selected global or page theme', () => {
  const script = read('assets/js/theme-controller.js');
  assert.match(script, /scope\.value === 'global' \? globalTheme\(\) : currentTheme\(\)/);
  assert.match(script, /clearPageOverrides\(\)/);
});

test('shared finish-pass styling defines readable semantic states in both themes and responsive action groups', () => {
  const css = read('assets/css/theme-system.css');
  assert.match(css, /--taiba-success-text/);
  assert.match(css, /--taiba-danger-text/);
  assert.match(css, /--taiba-warning-text/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*--taiba-success-text/);
  assert.match(css, /\.status\.good/);
  assert.match(css, /\.actions/);
  assert.match(css, /\[role="tablist"\]/);
  assert.match(css, /max-width:420px/);
});
