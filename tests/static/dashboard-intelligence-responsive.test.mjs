import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('desktop zoom reflows application grids instead of scaling a fixed page',async()=>{
  const css=await read('assets/css/app-viewport.css');
  assert.match(css,/repeat\(auto-fit,minmax/);
  assert.match(css,/\.apps-grid/);
  assert.match(css,/\.owner-report-grid/);
  assert.match(css,/\.owner-links/);
  assert.match(css,/\.kpis/);
  assert.match(css,/overflow-x:auto/);
  for(const path of ['app/index.html','app/catalog.html','app/dashboard.html','app/reception.html','app/results-workbench.html','app/settings.html','app/sync-center.html','app/workday.html','app/cms-editor.html','app/platform-admin.html','app/site-management.html','app/site-preview.html','portal/index.html','website/index.html']){
    assert.match(await read(path),/app-viewport\.css/,path+' must load shared adaptive layout rules');
  }
});

test('historical accountant archive accepts multiple workbooks and reviews every sheet',async()=>{
  const ui=await read('assets/js/dashboard-financial-import.js');
  assert.match(ui,/type="file"[^>]*multiple/);
  assert.match(ui,/queuedFiles/);
  assert.match(ui,/loadQueuedFile/);
  assert.match(ui,/advanceQueuedImport/);
  assert.match(ui,/تخطي هذه الورقة/);
  assert.match(ui,/suggestFinancialMapping/);
  assert.match(ui,/analyzeFinancialRows/);
  assert.match(ui,/createOwnerFinancialBatch/);
  assert.match(ui,/row_fingerprint/);
});

test('historical analysis is gated by a doctor monthly approval and supports explicit manual values',async()=>{
  const ui=await read('assets/js/dashboard-financial-import.js');
  const repository=await read('dashboard/owner-financial-repository.js');
  const dashboard=await read('assets/js/dashboard.js');
  assert.match(ui,/liveReportAvailable/);
  assert.match(ui,/data-approval-source/);
  assert.match(ui,/data-approval-manual/);
  assert.match(ui,/manualValues/);
  assert.match(ui,/listOwnerMonthApprovals/);
  assert.match(ui,/الشهر لم يعتمد بعد/);
  assert.match(repository,/approvalHistory/);
  assert.match(repository,/slice\(-20\)/);
  assert.match(dashboard,/الشهر غير معتمد ماليًا بعد/);
});
