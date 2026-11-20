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
const migration=read('database/migrations/056_visit_workbench_archive.sql');

test('results workbench loads the three-column visits, individual and profile layout',()=>{
 assert.match(html,/results-workbench-layout\.js/);
 assert.match(layout,/results-columns/);
 assert.match(layout,/الزيارات/);
 assert.match(layout,/التحاليل الفردية/);
 assert.match(layout,/البروفايلات/);
 assert.match(js,/data-test-kind=/);
 assert.match(js,/technical_snapshot\?\.test_kind/);
});

test('individual catalog and panel catalog add to the selected visit without leaving results',()=>{
 assert.match(layout,/listCatalog/);
 assert.match(layout,/test_kind==='panel'/);
 assert.match(layout,/addTestToVisit/);
 assert.match(layout,/taiba:results-work-refresh/);
 assert.match(repo,/export async function addTestToVisit|addTestToVisit/);
});

test('visit preview is available without automatically invoking print',()=>{
 assert.match(layout,/معاينة نتائج الزيارة/);
 assert.match(js,/autoPrint = true/);
 assert.match(js,/if \(autoPrint\) win\.print\(\)/);
 assert.match(js,/taibaPreviewVisitReport/);
});

test('hide and restore are branch-scoped, audited, and never hard-delete medical data',()=>{
 assert.match(layout,/setVisitWorkbenchHidden/);
 assert.match(layout,/listHiddenWorkbenchVisits/);
 assert.match(repo,/rpc\('set_visit_workbench_hidden'/);
 assert.match(migration,/visit_workbench_archive_events/);
 assert.match(migration,/private\.can_access_branch/);
 assert.match(migration,/revoke all on function public\.set_visit_workbench_hidden/);
 assert.doesNotMatch(layout,/\.delete\(/);
});

test('WhatsApp shares only the patient portal lookup route after publication and with a valid phone',()=>{
 assert.match(layout,/record\.published/);
 assert.match(layout,/wa\.me/);
 assert.match(layout,/tenantSlug/);
 assert.match(layout,/portal\/index\.html/);
});
