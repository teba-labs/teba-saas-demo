import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const html = fs.readFileSync(path.join(root, 'app/settings.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/settings-center.js'), 'utf8');
const staffRepo = fs.readFileSync(path.join(root, 'modules/staff/repository.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database/migrations/018_staff_auth_linking.sql'), 'utf8');
const actorMigration = fs.readFileSync(path.join(root, 'database/migrations/019_enforce_employee_actor_identity.sql'), 'utf8');
const actorFixMigration = fs.readFileSync(path.join(root, 'database/migrations/021_employee_actor_pending_fields.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/invite-branch-employee/index.ts'), 'utf8');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const reception = fs.readFileSync(path.join(root, 'assets/js/reception.js'), 'utf8');
const workday = fs.readFileSync(path.join(root, 'assets/js/workday.js'), 'utf8');
const results = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const appHome = fs.readFileSync(path.join(root, 'assets/js/app-home.js'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'assets/js/catalog.js'), 'utf8');

test('owner settings provides a separate Auth-account linking flow', () => {
  for (const id of ['inviteStaffForm', 'staffInviteEmail', 'inviteStaffId']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(script, /functions\.invoke\('invite-branch-employee'/);
  assert.match(script, /accountType==='owner'/);
  assert.match(staffRepo, /auth_user_id/);
  assert.match(script, /!x\.auth_user_id/);
});

test('employee Auth linking is tenant and branch scoped and service-role only', () => {
  assert.match(migration, /references auth\.users\(id\)/);
  assert.match(migration, /unique index if not exists staff_directory_tenant_auth_user_uidx/);
  assert.match(migration, /account_type = 'owner'/);
  assert.match(migration, /grant execute on function public\.owner_assign_branch_employee.*to service_role/);
  assert.match(migration, /branch_memberships/);
  assert.match(actorMigration, /completed_by_staff_id/);
  assert.match(actorMigration, /auth_user_id = auth\.uid\(\)/);
  assert.match(actorMigration, /Patient creation is also attributed/);
  assert.match(actorFixMigration, /v_field in \('approved_by_staff_id','completed_by_staff_id','closed_by_staff_id'\)/);
  assert.match(edge, /auth\.getUser\(bearer\)/);
  assert.match(edge, /account_type', 'owner'/);
  assert.match(edge, /owner_assign_branch_employee/);
  assert.match(edge, /owner_set_branch_employee_active/);
  assert.equal((edge.match(/const action = String\(body\.action/g) || []).length, 1);
  assert.match(edge, /action === 'invite' && \(email\.length > 254 \|\| !EMAIL\.test\(email\)\)/);
  assert.match(edge, /deleteUser\(employeeUser\.id\)/);
  assert.match(config, /\[functions\.invite-branch-employee\]\s+verify_jwt = true/);
});

test('employee operational screens bind staff identity to the authenticated user', () => {
  for (const source of [reception, workday, results]) {
    assert.match(source, /accountType==='employee'|accountType === 'employee'/);
    assert.match(source, /auth_user_id/);
    assert.match(source, /state\.userId/);
    assert.match(source, /staffSelect.*disabled/);
  }
});

test('catalog and global financial administration are owner-only', () => {
  assert.match(appHome, /id:'catalog',[^\n]*roles:\['owner'\]/);
  assert.match(appHome, /id:'dashboard',[^\n]*roles:\['owner'\]/);
  assert.match(catalog, /accountType==='owner'/);
  assert.match(catalog, /إدارة كتالوج التحاليل والأسعار متاحة لمالك المعمل فقط/);
});
