import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const repository = fs.readFileSync(path.join(root, 'modules/results/repository.js'), 'utf8');
const worklist = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database/migrations/017_atomic_result_transitions.sql'), 'utf8');

test('staff workflow accepts saved results without a separate visit approval action', () => {
  assert.ok(repository.includes("rpc('approve_visit_with_auto_completion'"));
  assert.ok(repository.includes("rpc('complete_visit_test_atomic'"));
  assert.ok(page.includes('await completeVisitTestAtomic('));
  assert.ok(!page.includes('approveVisitWithAutoCompletion'));
  assert.ok(!page.includes('async function approve(button)'));
  assert.ok(page.includes('حفظ النتائج'));
  assert.ok(!page.includes('complete-test'));
  assert.ok(!repository.includes(".update({ status: 'completed' })"));
  assert.doesNotMatch(repository, /approved_by_staff_id: staffId/);
});

test('atomic result transitions validate branch access and active operational staff', () => {
  for (const name of ['complete_visit_test_atomic', 'approve_visit_atomic']) {
    assert.match(migration, new RegExp('function public\\.' + name));
  }
  assert.equal((migration.match(/private\.can_access_branch\(p_tenant_id, p_branch_id\)/g) || []).length, 2);
  assert.equal((migration.match(/sd\.branch_id = p_branch_id and sd\.is_active/g) || []).length, 2);
  assert.match(migration, /completed_by_staff_id = p_staff_id/);
  assert.match(migration, /completed_at = now\(\)/);
  assert.match(migration, /Required results are missing/);
  assert.match(migration, /Every requested test must be completed before approval/);
  assert.match(migration, /Required results are missing; approval is blocked/);
  assert.match(migration, /Visit is already approved/);
  assert.doesNotMatch(page, /async function approve\(/);
  assert.match(page, /const locked = item\.status === 'completed'/);
  assert.match(migration, /revoke all on function public\.complete_visit_test_atomic/);
  assert.match(migration, /revoke all on function public\.approve_visit_atomic/);
  assert.match(migration, /guard_result_workflow_transition/);
  assert.match(migration, /Complete tests through complete_visit_test_atomic/);
  assert.match(migration, /Approve visits through approve_visit_atomic/);
  assert.equal((migration.match(/set_config\('app\.atomic_result_transition', 'on', true\)/g) || []).length, 2);
});

test('results worklist hydrates existing values in one batch query', () => {
  assert.match(repository, /listResultsForVisitTests/);
  assert.match(repository, /\.in\('visit_test_id', chunk\)/);
  assert.match(repository, /\.range\(offset, offset \+ 499\)/);
  assert.match(worklist, /listBranchWorkPage/);
  assert.match(worklist, /workPageSize: 100/);
  assert.match(worklist, /nextWorkPage/);
  assert.match(worklist, /listResultsForVisitTests\(/);
  assert.doesNotMatch(worklist, /for \(const item of state\.work\) \{\s*const rows = await listResults/);
});

test('completed test cards are read-only and the server rejects post-completion draft writes', () => {
  const screen = page;
  assert.match(migration, /v_test\.status = 'completed'[\s\S]*?Test is already completed/);
  assert.match(migration, /v_test_status = 'completed'[\s\S]*?Completed test results are locked/);
  assert.match(migration, /v_visit_status in \('approved','published'\)/);
  assert.match(screen, /const locked = item\.status === 'completed'/);
  assert.ok(screen.includes("disabled=locked?"));
  assert.ok(screen.includes('${metadata}${disabled}'));
  assert.match(screen, /التحليل مكتمل — النتائج للعرض فقط/);
});

test('one-action approval checks required visible values, preserves branch security and completes tests atomically',()=>{
 const migration=fs.readFileSync(path.join(root,'database/migrations/103_one_action_visit_approval.sql'),'utf8');
 assert.ok(migration.includes('function public.approve_visit_with_auto_completion'));
 assert.ok(migration.includes('private.can_access_branch'));
 assert.ok(migration.includes('An active staff identity for this branch is required'));
 assert.ok(migration.includes('نتائج مطلوبة لم تُسجل بعد'));
 assert.ok(migration.includes('completed_by_staff_id=coalesce(completed_by_staff_id,p_staff_id)'));
 assert.ok(migration.includes("status='approved'"));
 assert.ok(migration.includes('grant execute on function public.approve_visit_with_auto_completion'));
 assert.ok(migration.includes("nullif(p->'formula','null'::jsonb) is null"));
});

test('saving a partially entered result never attempts visit-wide approval', () => {
 const start=page.indexOf('async function saveResultsForTest(');
 const end=page.indexOf('window.taibaSaveResultsForTest =',start);
 assert.ok(start>=0 && end>start);
 const saveFlow=page.slice(start,end);
 assert.match(saveFlow,/await saveVisitDrafts\(visitId\)/);
 assert.doesNotMatch(saveFlow,/approveVisitWithAutoCompletion\(/);
 assert.match(saveFlow,/resultAccepted: true/);
 assert.match(saveFlow,/معاينتها وطباعتها ونشرها/);
});
