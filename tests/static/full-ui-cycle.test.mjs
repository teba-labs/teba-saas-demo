import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('visit numbers are reserved atomically per laboratory across branches with a readable prefix',()=>{
 const sql=read('database/migrations/076_branch_visit_number_sequences.sql');
 const js=read('assets/js/reception.js');
 assert.match(sql,/create table if not exists private\.tenant_visit_sequences/);
 assert.match(sql,/tenant_id uuid primary key/);
 assert.match(sql,/private\.can_access_branch\(p_tenant_id, p_branch_id\)/);
 assert.match(sql,/on conflict \(tenant_id\)[\s\S]*last_value = private\.tenant_visit_sequences\.last_value \+ 1/i);
 assert.match(sql,/lpad\(v_next::text, 5, '0'\)/);
 assert.match(sql,/revoke all on function public\.reserve_branch_visit_number[\s\S]*grant execute on function public\.reserve_branch_visit_number[\s\S]*to authenticated/i);
 assert.match(js,/reserve_branch_visit_number/);
 assert.match(js,/p_tenant_code:tenantCode,p_branch_code:branchCode/);
 assert.match(js,/await state\.visitNumberPromise/);
 assert.match(js,/Keep the existing collision-resistant reference until migration 076 is applied/);
});

test('each test opens inline in the selected visit without a page hop; legacy direct-entry route remains available',()=>{
 const page=read('app/result-entry.html');
 const layout=read('assets/js/results-workbench-layout.js');
 const workbench=read('app/results-workbench.html');
 assert.match(page,/class="result-entry-page"/);
 for(const id of ['entryView','entryTitle','entryContext','entryBack','entryWorkspace','workList'])assert.match(page,new RegExp('id="'+id+'"'));
 assert.ok(layout.includes('function testLauncher(node,record,kind,workspace)'));
 assert.match(layout,/test-detail/);
 assert.ok(layout.includes('placeholder.replaceWith(node)'));
 assert.ok(!layout.includes('location.href=url.href'));
 assert.ok(layout.includes("document.body.classList.contains('result-entry-page')"));
 assert.ok(layout.includes('entry.replaceChildren(visitActions,node)'));
 assert.ok(layout.includes("'results-workbench.html'"));
 assert.ok(layout.includes('record.patientAge'));
 assert.match(layout,/الهاتف/);
 assert.ok(workbench.includes('results-workbench-layout.js'));
});

test('reception preserves post-save actions for online and offline visit intake',()=>{
 const page=read('app/reception.html'),js=read('assets/js/reception.js');
 assert.match(page,/id="postSaveActions"/);
 assert.match(page,/id="goToResults"/);
 assert.match(page,/id="newPatientAfterSave"/);
 assert.match(js,/\$\('goToResults'\)\.addEventListener\('click',\(\)=>goToResults\(\)\)/);
 assert.match(js,/\$\('newPatientAfterSave'\)\.addEventListener\('click',\(\)=>\{clearIntake\(\);focusNewPatient\(\);\}\)/);
 assert.match(js,/تم حفظ الزيارة محليًا/);
 assert.match(js,/تم حفظ الزيارة والفاتورة بنجاح/);
});

test('theme controls and semantic palette are available on the priority screens',()=>{
 const theme=read('assets/css/theme-system.css');
 for(const page of ['app/reception.html','app/results-workbench.html','app/result-entry.html','app/catalog.html','app/settings.html','app/dashboard.html','app/platform-admin.html','portal/index.html','website/index.html']){
  assert.match(read(page),/theme-controller\.js/,page);
 }
 for(const token of ['--taiba-page:#F4F7FA','--taiba-surface:#FFFFFF','--taiba-accent:#168C8C','--taiba-page:#101D2B','--taiba-surface:#17293B','--taiba-ink:#F3F7FA'])assert.ok(theme.includes(token),token);
 assert.match(theme,/::placeholder/);
});

test('priority pages have responsive breakpoints for desktop tablet and phone',()=>{
 const reception=read('assets/css/reception.css'),results=read('assets/css/results-workbench.css'),catalog=read('assets/css/catalog.css');
 assert.match(results,/entryView:not\(\[hidden\]\)/);
 for(const css of [reception,results])for(const bp of ['max-width:850px','max-width:620px'])assert.ok(css.includes(bp),bp);
 assert.ok(catalog.includes('max-width:900px'));
 assert.ok(catalog.includes('max-width:680px'));
 assert.match(results,/max-width:1050px/);
 assert.match(results,/test-launch-card/);
 assert.match(results,/repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(reception,/\.intake-content\{display:grid/);
 assert.match(catalog,/max-width:900px/);
});

test('offline shell includes the dedicated entry route and new appearance assets',()=>{
 const sw=read('service-worker.js');
 assert.match(sw,/taiba-smart-lab-shell-v44/);
 assert.match(sw,/\.\/app\/result-entry\.html/);
 assert.match(sw,/\.\/assets\/css\/theme-system\.css/);
 assert.match(sw,/\.\/assets\/js\/results-workbench-layout\.js/);
});

test('application navigation does not render escaped newline text in the header',()=>{
 for(const page of ['app/reception.html','app/result-entry.html','app/results-workbench.html']){
  assert.doesNotMatch(read(page),/\\n/,'literal backslash-n in '+page);
 }
});
