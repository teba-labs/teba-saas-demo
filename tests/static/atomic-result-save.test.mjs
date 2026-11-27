import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('saving results accepts entered values without a separate visit-wide approval action', () => {
  const ui = read('assets/js/results-workbench.js');
  assert.ok(ui.includes('for (const item of items)'));
  assert.ok(ui.includes('await saveDraftResults('));
  assert.ok(ui.includes('saveResultsForTest('));
  assert.ok(!ui.includes('approveVisitWithAutoCompletion('));
  assert.ok(!ui.includes('await saveDraftResult('));
});

test('result repository sends one tenant, branch, visit-test and staff scoped RPC request', () => {
  const repo = read('modules/results/repository.js');
  assert.match(repo, /db\(\)\.rpc\('save_draft_results_idempotent'/);
  assert.match(repo, /operationId = crypto\.randomUUID\(\)/);
  assert.match(repo, /entityType: 'draft_results'/);
  assert.match(repo, /p_tenant_id: tenantId, p_branch_id: branchId,\s*p_visit_test_id: visitTestId/);
  assert.match(repo, /new Set\(prepared\.map\(item => item\.parameter_code\)\)/);
});

test('migration makes the batch all-or-nothing and retains branch, staff, published and snapshot guards', () => {
  const sql = read('database/migrations/010_atomic_draft_result_save.sql');
  const idempotency = read('database/migrations/074_offline_draft_results_idempotency.sql');
  assert.match(sql, /security definer[\s\S]*set search_path = pg_catalog, public, private/i);
  assert.match(sql, /private\.can_access_branch\(p_tenant_id,p_branch_id\)/i);
  assert.match(sql, /sd\.branch_id=p_branch_id and sd\.is_active/i);
  assert.match(sql, /for update of v, vt/i);
  assert.match(sql, /v_is_published[\s\S]*v_status='published'/i);
  assert.match(sql, /insert into public\.test_results[\s\S]*on conflict \(visit_test_id, parameter_code\) do update/i);
  assert.match(sql, /return query[\s\S]*returning \*/i);
  assert.match(sql, /revoke all on function public\.save_draft_results_atomic[\s\S]*grant execute[\s\S]*to authenticated/i);
  assert.match(idempotency, /save_draft_results_atomic\(/);
  assert.match(idempotency, /primary key \(tenant_id, branch_id, operation_id\)/);
});
