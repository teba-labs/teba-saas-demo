import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const repository = fs.readFileSync(path.join(root, 'modules/results/repository.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database/migrations/013_atomic_result_transitions.sql'), 'utf8');

test('result completion and visit approval use atomic server RPCs', () => {
  assert.match(repository, /rpc\('complete_visit_test_atomic'/);
  assert.match(repository, /rpc\('approve_visit_atomic'/);
  assert.doesNotMatch(repository, /\.update\(\{ status: 'completed' \}\)/);
  assert.doesNotMatch(repository, /approved_by_staff_id: staffId/);
  assert.match(page, /branchId: state\.branch\.id, visitTestId: button\.dataset\.testId, staffId:/);
});

test('atomic result transitions validate branch access and active operational staff', () => {
  for (const name of ['complete_visit_test_atomic', 'approve_visit_atomic']) {
    assert.match(migration, new RegExp('function public\\.' + name));
  }
  assert.equal((migration.match(/private\.can_access_branch\(p_tenant_id, p_branch_id\)/g) || []).length, 2);
  assert.equal((migration.match(/sd\.branch_id = p_branch_id and sd\.is_active/g) || []).length, 2);
  assert.match(migration, /Required results are missing/);
  assert.match(migration, /Every requested test must be completed before approval/);
  assert.match(migration, /revoke all on function public\.complete_visit_test_atomic/);
  assert.match(migration, /revoke all on function public\.approve_visit_atomic/);
});
