import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('new tenant creation provisions a usable first branch and owner operational identity atomically', () => {
  const migration = read('database/migrations/122_owner_branch_access_in_onboarding.sql');
  const page = read('app/platform-admin.html');
  const js = read('assets/js/platform-admin.js');\n  const doctorMigration = read('database/migrations/123_owner_doctor_name_onboarding.sql');
  assert.ok(migration.includes("values(v_tenant_id,'الفرع الرئيسي')"));
  assert.ok(migration.includes('public.staff_directory'));
  assert.ok(migration.includes('auth_user_id'));
  assert.ok(migration.includes('public.print_settings'));
  assert.ok(migration.includes('public.site_branch_profiles'));
  assert.ok(migration.includes('public.tenant_usage'));
  assert.ok(migration.includes('public.subscriptions'));
  assert.ok(migration.includes('private.is_platform_admin()'));
  assert.ok(migration.includes('branch_memberships is employee-only'));
  assert.ok(js.includes('platform_create_tenant_for_email'));
  assert.ok(page.includes('إنشاء المعمل وربط صاحبه'));\n  assert.ok(page.includes('ownerDisplayName'));\n  assert.ok(js.includes('p_owner_display_name'));\n  assert.ok(doctorMigration.includes('p_owner_display_name text'));\n  assert.ok(doctorMigration.includes('public.staff_directory'));
});

test('owner branch provisioning does not assign the owner to employee-only branch membership', () => {
  const migration = read('database/migrations/122_owner_branch_access_in_onboarding.sql');
  assert.equal(migration.includes('insert into public.branch_memberships'), false);
});
