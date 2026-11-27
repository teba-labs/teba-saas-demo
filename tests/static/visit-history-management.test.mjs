import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const [historyRepo, receptionRepo, resultRepo, reportRepo, syncAdapters, receptionUi, page, workbench, layout, migration131, migration132, migration134, migration135, worker] = await Promise.all([
  read('../../modules/reception/visit-management-repository.js'),
  read('../../modules/reception/repository.js'),
  read('../../modules/results/repository.js'),
  read('../../modules/reports/repository.js'),
  read('../../offline/supabase-adapters.js'),
  read('../../assets/js/reception-visit-history.js'),
  read('../../app/reception.html'),
  read('../../assets/js/results-workbench.js'),
  read('../../assets/js/results-workbench-layout.js'),
  read('../../database/migrations/131_visit_history_management.sql'),
  read('../../database/migrations/132_fix_published_correction_and_owner_delete.sql'),
  read('../../database/migrations/134_owner_only_approved_visit_corrections.sql'),
  read('../../database/migrations/135_remove_reasons_from_all_correction_rpcs.sql'),
  read('../../service-worker.js'),
]);
const migration = migration131 + '\\n' + migration132 + '\\n' + migration134 + '\\n' + migration135;

test('reception history searches all tenant visits and shows an exact registered visit count', () => {
  assert.match(historyRepo, /export async function listVisitHistory/);
  assert.match(historyRepo, /select\(selection,\{count:'exact'\}\)/);
  assert.match(historyRepo, /totalQuery=db\(\)\.from\('visits'\)/);
  assert.match(historyRepo, /if\(accountType==='employee'\)query=query\.eq\('branch_id',branchId\)/);
  assert.match(receptionUi, /إجمالي الزيارات المسجلة للمعمل/);
  assert.match(page, /id="visitHistorySearch"/);
  assert.match(page, /id="visitHistoryTotal"/);
});

test('offline visit history warms patient, visit and visit-test rows without converting imported archives', () => {
  assert.match(historyRepo, /export async function warmVisitHistory/);
  assert.match(historyRepo, /await cacheRows\('visit_tests',page\)/);
  assert.match(historyRepo, /complete:false/);
  assert.doesNotMatch(historyRepo, /historical_results/);
});

test('reception provides simple patient and visit editing, test add/remove, cancellation, and local-only removal', () => {
  for (const name of ['updatePatientDemographics','updateVisitDetails','cancelVisit','cancelVisitTest','deleteVisitPermanently','hideVisitOnThisDevice']) {
    assert.match(historyRepo, new RegExp('export async function '+name));
  }
  for (const action of ['edit-patient','edit-visit','add-test','cancel-test','cancel-visit','hide-device','delete-visit']) {
    assert.match(receptionUi, new RegExp('data-history-action="'+action+'"'));
  }
  assert.match(receptionUi, /تعديل بيانات المريض/);
  assert.match(receptionUi, /تعديل بيانات الزيارة/);
  assert.match(receptionUi, /window\.confirm\('إلغاء الزيارة/);
  assert.match(receptionUi, /إخفاء هذه الزيارة من هذا الجهاز فقط/);
});

test('visit edits and analysis additions queue behind local visit creation for offline safety', () => {
  assert.match(receptionRepo, /entityType:'visit_test_add'/);
  assert.match(receptionRepo, /localVisit\?\.local_intake_operation_id/);
  assert.match(historyRepo, /entityType:'patient_update'/);
  assert.match(historyRepo, /entityType:'visit_update'/);
  assert.match(historyRepo, /entityType:'visit_cancel'/);
  assert.match(historyRepo, /entityType:'visit_test_cancel'/);
  for (const name of ['patient_update','visit_update','visit_cancel','visit_test_cancel','visit_test_add']) {
    assert.match(syncAdapters, new RegExp(name+': async operation'));
  }
});

test('completed-result corrections no longer prompt for a reason and queue safely offline', () => {
  assert.match(reportRepo, /export async function correctVisitResultWithFlag/);
  assert.match(reportRepo, /p_reason:null/);
  assert.match(reportRepo, /entityType:'result_correction'/);
  assert.match(syncAdapters, /result_correction: async operation/);
  assert.doesNotMatch(workbench, /prompt\(['"]سبب.*تصحيح/);
  assert.match(workbench, /canCorrectApproved/);
});

test('visit-specific range edits require no reason, never alter catalog, and sync offline idempotently', () => {
  assert.match(resultRepo, /saveVisitParameterRangeOverride/);
  assert.match(resultRepo, /entityType:'range_override'/);
  assert.match(resultRepo, /set_visit_parameter_range_override_idempotent/);
  assert.match(syncAdapters, /range_override: async operation/);
  assert.match(migration, /visit_test_parameter_range_overrides alter column reason drop not null/i);
  assert.match(migration, /reference_ranges=excluded\.reference_ranges/);
  assert.match(migration, /old_reference_ranges,new_reference_ranges/);
});

test('approved unpublished result and range corrections are owner-only', () => {
  assert.match(migration, /Only the lab owner may correct an approved unpublished visit/);
  assert.match(workbench, /canCorrectApproved = group\.visit\?\.status === 'approved' && !isPublished && state\.tenant\?\.accountType === 'owner'/);
  assert.match(workbench, /canEditApprovedRange = group\.visit\?\.status === 'approved' && !isPublished && state\.tenant\?\.accountType === 'owner'/);
});

test('published correction preserves the report history but no longer requires a text reason', () => {
  assert.match(migration, /app\.result_correction/);
  assert.doesNotMatch(migration, /A published result correction requires a documented reason/);
  assert.match(migration, /correction_reason=null/);
});


test('no result correction RPC requires a user-entered reason', () => {
  assert.doesNotMatch(migration135, /Correction reason is required/);
  assert.match(migration135, /correction_reason=null/);
  assert.match(reportRepo, /correctPublishedResult[\s\S]*?p_reason: null/);
  assert.match(reportRepo, /correctCompletedVisitResult[\s\S]*?p_reason:null/);
  assert.doesNotMatch(reportRepo, /\[reason,'reason'\]|String\(reason\|\|'\)/);
});

test('visit cancellation and individual test removal are branch-scoped; hard delete is owner-only', () => {
  assert.match(migration, /create or replace function public\.cancel_visit_atomic/i);
  assert.match(migration, /create or replace function public\.cancel_visit_test_atomic/i);
  assert.match(migration, /if v_type<>'owner' then raise exception 'Permanent visit deletion is restricted to the lab owner'/);
  assert.match(migration, /public\.payments/);
  assert.match(migration, /public\.report_versions/);
  assert.match(migration, /public\.file_metadata/);
  assert.match(migration, /'permanently_deleted'/);
  assert.match(migration, /security definer/i);
});

test('cancelled or published visits cannot receive new analyses from the result workbench', () => {
  assert.match(layout, /!\['approved','published','cancelled'\]\.includes\(record\.visitStatus\)/);
});

test('the full visit history modules are included in the offline shell', () => {
  assert.match(worker, /taiba-smart-lab-shell-v99/);
  assert.match(worker, /reception-visit-history\.js/);
  assert.match(worker, /visit-management-repository\.js/);
});
