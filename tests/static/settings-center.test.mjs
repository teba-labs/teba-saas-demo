import assert from 'node:assert/strict';import fs from 'node:fs';const root=new URL('../../',import.meta.url);const h=fs.readFileSync(new URL('app/settings.html',root),'utf8'),j=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8'),a=fs.readFileSync(new URL('assets/js/app-home.js',root),'utf8'),w=fs.readFileSync(new URL('service-worker.js',root),'utf8');assert.match(h,/مركز قيادة المعمل/);assert.match(h,/printSettingsForm/);assert.match(h,/printBranch/);assert.match(h,/branchForm/);assert.match(h,/newBranchName/);assert.match(h,/expenseCategoryForm/);assert.match(h,/staffNameForm/);assert.match(h,/staffBranch/);assert.match(h,/expenseCategoriesList/);assert.match(j,/getLabSettings/);assert.match(j,/updateLabSettings/);assert.match(j,/savePrintSettings/);assert.match(j,/createBranch/);assert.match(j,/branchForm/);assert.match(j,/saveExpenseCategory/);assert.match(j,/setExpenseCategoryActive/);assert.match(j,/listBranchStaff/);assert.match(j,/saveStaffName/);
assert.match(j,/updateStaffName/);
assert.match(j,/data-edit-staff/);
assert.match(h,/editStaffId/);
assert.match(h,/cancelStaffEdit/);assert.match(j,/setStaffActive/);assert.match(j,/getPrintSettings/);assert.match(j,/actor_label/);assert.match(j,/printSettingsForm/);assert.match(j,/JSON\.parse/);assert.match(j,/accountType==='owner'/);assert.match(a,/href:'settings.html'/);assert.match(w,/app\/settings.html/);assert.match(w,/settings-center.js/);const r=fs.readFileSync(new URL('modules/settings/repository.js',root),'utf8');assert.match(r,/export async function savePrintSettings/);assert.match(r,/onConflict: 'tenant_id,branch_id'/);assert.match(r,/settings_json: settings/);assert.match(r,/export async function createBranch/);assert.match(r,/export async function updateBranch/);assert.match(j,/data-edit-branch/);assert.match(j,/updateBranch/);assert.match(h,/editBranchId/);assert.match(h,/cancelBranchEdit/);assert.match(r,/export async function setBranchActive/);const e=fs.readFileSync(new URL('modules/expenses/repository.js',root),'utf8');assert.match(e,/export async function saveExpenseCategory/);assert.match(e,/onConflict: 'tenant_id,name'/);assert.match(e,/export async function setExpenseCategoryActive/);
assert.match(e,/\.update\(\{ name: cleanName \}\)/);
assert.match(e,/\.eq\('tenant_id', tenantId\)\.eq\('id', id\)/);
assert.match(j,/data-edit-expense-category/);
assert.match(j,/editExpenseCategoryId/);
assert.match(h,/cancelExpenseCategoryEdit/);const ctx=fs.readFileSync(new URL('core/tenant/context.js',root),'utf8');assert.match(ctx,/phone, map_link, is_active/);const audit=fs.readFileSync(new URL('modules/settings/audit-repository.js',root),'utf8');assert.match(audit,/actor_user_id/);assert.match(audit,/tenant_memberships/);assert.match(audit,/staff_directory/);const s=fs.readFileSync(new URL('modules/staff/repository.js',root),'utf8');assert.match(s,/onConflict: 'tenant_id,branch_id,display_name'/);assert.match(s,/export async function setStaffActive/);
assert.match(s,/export async function updateStaffName/);
assert.match(h,/id="dataManagementSettings"/);
assert.match(h,/href="data-import.html"/);
assert.match(h,/href="sync-center.html"/);
assert.match(h,/النسخة السحابية هنا تحفظ نسخة من بيانات هذا الجهاز فقط/);

const backup=fs.readFileSync(new URL('offline/backup.js',root),'utf8');
const archiveStore=fs.readFileSync(new URL('modules/dashboard/historical-workbooks.js',root),'utf8');
const sync=fs.readFileSync(new URL('assets/js/sync-center.js',root),'utf8');
assert.match(backup,/const VERSION = 2/);
assert.match(backup,/LEGACY_VERSION = 1/);
assert.match(backup,/exportHistoricalWorkbooks/);
assert.match(backup,/restoreHistoricalWorkbooks/);
assert.match(backup,/historical_workbooks/);
assert.match(backup,/MAX_HISTORICAL_ARCHIVE_BYTES/);
assert.match(archiveStore,/export async function exportHistoricalWorkbooks/);
assert.match(archiveStore,/export async function restoreHistoricalWorkbooks/);
assert.match(archiveStore,/row.tenantId!==String\(tenantId\)/);
assert.match(sync,/historicalWorkbooksRestored/);
assert.match(h,/ملفات Excel التاريخية المحفوظة لهذا المعمل/);
assert.match(h,/ولا تشمل مرفقات المرضى/);

const branchSettings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
assert.match(branchSettings,/const BRANCH_ARCHIVE_READY=true/);
assert.match(branchSettings,/data-branch-toggle/);
assert.doesNotMatch(branchSettings,/data-branch-toggle=.*? disabled title=/);



const staffToggleHandlers=(j.match(/\$\('staffNamesList'\)\.addEventListener\('click'/g)||[]).length;
const expenseToggleHandlers=(j.match(/\$\('expenseCategoriesList'\)\.addEventListener\('click'/g)||[]).length;
assert.equal(staffToggleHandlers,1,'staff edit/status actions must have one delegated click handler');
assert.equal(expenseToggleHandlers,1,'expense category edit/status actions must have one delegated click handler');
assert.match(h,/id="refreshAuditLogs"/);
assert.match(h,/id="auditLogsList"/);
assert.match(j,/listOwnerAuditLogs/);
assert.match(j,/const BRANCH_ARCHIVE_READY=true/);

console.log('PASS: all seven owner settings areas, branch archive, local backup and single delegated handlers are wired.');

const h2=fs.readFileSync(new URL('app/settings.html',root),'utf8'),j2=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
const ar=fs.readFileSync(new URL('modules/settings/assets-repository.js',root),'utf8'),br=fs.readFileSync(new URL('modules/settings/cloud-backup-repository.js',root),'utf8');
assert.match(h2,/id="labLogoFile"/);assert.match(h2,/id="printPaperSize"/);assert.doesNotMatch(h2,/printSettingsJson|بيانات الطباعة بصيغة JSON/);
assert.match(h2,/id="backupBranch"/);assert.match(h2,/id="restoreCloudBackup"/);assert.match(j2,/uploadLabAsset/);assert.match(j2,/createCloudBackup/);assert.match(j2,/downloadCloudBackup/);
assert.match(ar,/tenant-site-assets/);assert.match(br,/tenant-backups/);assert.match(br,/checksum_sha256/);assert.match(br,/browser-local-cache/);assert.match(r,/inherited: true/);
console.log('PASS: structured print controls, tenant-scoped assets, and private cloud copies of local snapshots are wired.');

const printMigration=fs.readFileSync(new URL('database/migrations/024_print_settings_audit.sql',root),'utf8');
assert.match(printMigration,/trg_audit_print_settings/);
assert.match(mw,/024_print_settings_audit/);

assert.match(printMigration,/trg_audit_backup_runs/);
