import assert from 'node:assert/strict';import fs from 'node:fs';const root=new URL('../../',import.meta.url);const h=fs.readFileSync(new URL('app/settings.html',root),'utf8'),j=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8'),a=fs.readFileSync(new URL('assets/js/app-home.js',root),'utf8'),w=fs.readFileSync(new URL('service-worker.js',root),'utf8');assert.match(h,/مركز قيادة المعمل/);assert.match(j,/getLabSettings/);assert.match(j,/updateLabSettings/);assert.match(j,/accountType==='owner'/);assert.match(a,/href:'settings.html'/);assert.match(w,/app\/settings.html/);assert.match(w,/settings-center.js/);console.log('PASS: owner settings center is linked and cached.');
const r=fs.readFileSync(new URL('modules/settings/repository.js',root),'utf8'),staff=fs.readFileSync(new URL('modules/staff/repository.js',root),'utf8');
for(const id of ['branchForm','branchAdminList','staffForm','categoryForm','printBranch','savePrint'])assert.match(h,new RegExp('id="'+id+'"'));
for(const fn of ['listBranchesForOwner','saveBranch','setBranchActive','listExpenseCategoriesForOwner','addExpenseCategory','setExpenseCategoryActive','savePrintSettings'])assert.match(r,new RegExp('export async function '+fn+'\\('));
for(const fn of ['listBranchStaff','saveStaffName','setStaffActive'])assert.match(staff,new RegExp('export async function '+fn+'\\('));
assert.match(j,/refreshOwnerData/);assert.match(j,/data-toggle-branch/);assert.match(j,/data-toggle-category/);assert.match(j,/savePrintSettings/);
assert.match(h,/ليس إنشاء حسابات دخول أو كلمات مرور/);
console.log('PASS: owner controls are wired to tenant-scoped repositories; staff directory is not misrepresented as auth provisioning.');

const branchSave=r.slice(r.indexOf('export async function saveBranch'),r.indexOf('export async function setBranchActive'));
assert.match(branchSave,/update\(payload\)/);
assert.doesNotMatch(branchSave.slice(0,branchSave.indexOf(': await query.insert')),/is_active\s*:/);
assert.match(branchSave,/insert\(\{ \.\.\.payload, is_active: true \}\)/);
console.log('PASS: editing branch details preserves its active/paused state; only new branches start active.');

const audit=fs.readFileSync(new URL('modules/settings/audit-repository.js',root),'utf8');
assert.match(h,/id="refreshAudit"/);assert.match(h,/id="auditList"/);
assert.match(j,/listOwnerAuditLogs/);assert.match(j,/await refreshAudit\(\)/);
assert.match(w,/audit-repository\.js/);assert.match(w,/taiba-smart-lab-shell-v7/);
assert.match(audit,/\.eq\('tenant_id', tenantId\)/);assert.match(audit,/\.order\('occurred_at', \{ ascending: false \}\)/);assert.match(audit,/\.limit\(safeLimit\)/);
assert.match(audit,/select\('id, branch_id, action, table_name, occurred_at'\)/);
assert.doesNotMatch(audit,/old_data|new_data|patients|test_results/);
console.log('PASS: owner audit view is tenant-scoped, bounded, and excludes clinical payloads.');
