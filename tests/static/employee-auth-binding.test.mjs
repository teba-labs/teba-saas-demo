import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/014_employee_auth_binding.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/invite-branch-employee/index.ts'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'assets/js/settings-center.js'), 'utf8');
const reception = fs.readFileSync(path.join(root, 'assets/js/reception.js'), 'utf8');
const results = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');

test('employee Auth identity is linked to one active operational staff record', () => {
  assert.match(migration, /add column if not exists auth_user_id uuid references auth\.users/);
  assert.match(migration, /create unique index if not exists staff_directory_tenant_auth_user_uidx/);
  assert.match(migration, /owner_assign_branch_employee/);
  assert.match(migration, /owner_set_branch_employee_active/);
  assert.match(migration, /branch_memberships/);
  assert.match(migration, /account_type = 'employee'/);
  assert.match(migration, /already linked/);
});

test('employee invitations are owner-authorized and keep service credentials server-side', () => {
  assert.match(edge, /auth\.getUser\(bearer\)/);
  assert.match(edge, /account_type', 'owner'/);
  assert.match(edge, /inviteUserByEmail/);
  assert.match(edge, /owner_assign_branch_employee/);
  assert.match(edge, /owner_set_branch_employee_active/);
  assert.match(edge, /deleteUser\(employeeUser\.id\)/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY[^\n]*return|return[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(settings, /functions\.invoke\('invite-branch-employee'/);
});

test('employee action identity is checked against the linked Auth user', () => {
  assert.match(migration, /private\.enforce_staff_actor_binding/);
  assert.match(migration, /v_linked_user_id is distinct from auth\.uid\(\)/);
  assert.match(migration, /staff_actor_visits_created_by_staff_id/);
  assert.match(migration, /staff_actor_test_results_entered_by_staff_id/);
  assert.match(migration, /staff_actor_payments_received_by_staff_id/);
  assert.match(reception, /auth_user_id/);
  assert.match(results, /auth_user_id/);
});
