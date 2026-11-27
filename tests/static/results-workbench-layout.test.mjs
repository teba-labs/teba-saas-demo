import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('app/results-workbench.html');
const layout=read('assets/js/results-workbench-layout.js');
const js=read('assets/js/results-workbench.js');
const repo=read('modules/laboratory/repository.js');
const reception=read('modules/reception/repository.js');
const migration=read('database/migrations/056_visit_workbench_archive.sql');

test('results workbench loads the three-column visits, individual and profile layout',()=>{
 assert.ok(html.includes('results-workbench-layout.js'));
 for(const value of ['results-columns','الزيارات','التحاليل الفردية','البروفايلات']) assert.ok(layout.includes(value),value);
 assert.ok(js.includes('data-test-kind='));
 assert.ok(js.includes('technical_snapshot?.test_kind'));
});

test('individual catalog and panel catalog add to the selected visit without leaving results',()=>{
 for(const value of ['listCatalog',"test_kind==='panel'",'addTestToVisit','taiba:results-work-refresh']) assert.ok(layout.includes(value),value);
 assert.ok(reception.includes('addTestToVisit'));
 assert.ok(reception.includes('add_test_to_visit_atomic'));
 assert.ok(read('database/migrations/063_sync_billing_for_results_test_additions.sql').includes('sync_visit_billing_for_added_test'));
});

test('visit preview is available without automatically invoking print',()=>{
 assert.ok(layout.includes('معاينة التقرير قبل الطباعة'));
 assert.ok(js.includes('autoPrint = true'));
 assert.ok(js.includes('if (autoPrint) win.print()'));
 assert.ok(js.includes('taibaPreviewVisitReport'));
});

test('hide and restore are branch-scoped, audited, and never hard-delete medical data',()=>{
 for(const value of ['setVisitWorkbenchHidden','listHiddenWorkbenchVisits']) assert.ok(layout.includes(value),value);
 assert.ok(repo.includes("rpc('set_visit_workbench_hidden'"));
 for(const value of ['visit_workbench_archive_events','private.can_access_branch','revoke all on function public.set_visit_workbench_hidden']) assert.ok(migration.includes(value),value);
 assert.ok(!layout.includes('.delete('));
});

test('WhatsApp sharing stays disabled unless the optional patient portal is enabled',()=>{
 for(const value of ['record.published','wa.me','tenantSlug','portal/index.html','isPatientPortalEnabled','settings?.enabled === true','whatsapp.disabled=true','APP_ENV.supabase.url','/^20\\d{9,11}$/']) assert.ok(layout.includes(value),value);
});

test('test cards open in a same-screen modal instead of navigating to another page',()=>{
 assert.match(layout,/function testLauncher\(node,record,kind,workspace\)/);
 assert.match(layout,/result-entry-modal/);
 assert.match(layout,/placeholder\.replaceWith\(node\)/);
 assert.doesNotMatch(layout,/location\.href=url\.href/);
});
test('dedicated result entry page exposes result save and preview controls without visit approval',()=>{
 assert.ok(layout.includes('حفظ النتائج'));
 assert.doesNotMatch(layout,/اعتماد الزيارة/);
 assert.doesNotMatch(layout,/window\.taibaApproveVisit/);
 assert.match(layout,/window\.taibaPreviewVisitReport/);
});

test('individual and profile result forms open in an accessible same-screen modal with preserved return and save-complete actions',()=>{
 assert.match(layout,/result-entry-modal/);
 assert.match(layout,/role','dialog'/);
 assert.match(layout,/aria-modal','true'/);
 assert.match(layout,/رجوع دون فقد المدخلات/);
 assert.match(layout,/window\.taibaSaveResultsForTest\(record\.visitId,node\.dataset\.testId\)/);
 assert.doesNotMatch(layout,/taibaSaveAndCompleteTest/);
 assert.match(layout,/taiba:results-work-refresh/);
 assert.match(layout,/node\.dataset\.resultSaved/);
 assert.match(layout,/node\.addEventListener\('input'/);
 assert.match(js,/window\.taibaSaveAndAcceptResults = saveResultsForTest/);
 assert.match(js,/saveAndAcceptResults/);
 assert.match(js,/await saveVisitDrafts\(visitId\)/);
 assert.match(js,/تم حفظ النتائج/);
 assert.doesNotMatch(js.slice(js.indexOf('async function saveAndAcceptResults('),js.indexOf('window.taibaSaveAndAcceptResults =')),/approveVisitWithAutoCompletion\(/);
 assert.match(js,/saveAndAcceptResults/);
 assert.match(js,/completeVisitTestAtomic/);
 assert.match(js,/partialReport/);
 assert.match(js,/Print saved results/);
 assert.doesNotMatch(js,/سبب تصحيح النتيجة المنشورة/);
 assert.match(read('assets/css/results-workbench.css'),/\.result-entry-modal/);
 assert.doesNotMatch(layout,/className='test-detail'/);
});
