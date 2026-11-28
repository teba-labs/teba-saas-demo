import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('Windows installer upgrade is built from the exact Cycle 1 commit and same app identity', () => {
  const workflow = read('.github/workflows/windows-installer-upgrade.yml');
  const pkg = JSON.parse(read('package.json'));
  assert.match(workflow, /e7b3c202f9c3c17441a5cc8b2278e775769ef3e9/);
  assert.match(workflow, /baseline\\dist\\Taiba-Smart-Lab-Setup-1\.0\.0-x64\.exe/);
  assert.match(workflow, /dist\\Taiba-Smart-Lab-Setup-1\.0\.1-x64\.exe/);
  assert.equal(pkg.version, '1.0.1');
  assert.equal(JSON.parse(read('package.json')).build.appId, 'com.taibatech.smartlab');
});

test('upgrade smoke preserves the actual Dexie outbox, sync metadata, local settings, and OPFS files', () => {
  const helper = read('tests/windows/electron-devtools.mjs');
  const script = read('tests/windows/installer-upgrade-smoke.ps1');
  assert.match(helper, /TaibaSmartLabOfflineDB|offline\/database\.js/);
  assert.match(helper, /offlineDb\.sync_meta\.put/);
  assert.match(helper, /offlineDb\.outbox\.add/);
  assert.match(helper, /navigator\.storage\.getDirectory/);
  assert.match(helper, /localStorage\.setItem/);
  assert.match(helper, /allPassed/);
  assert.match(script, /Start-Process -FilePath \$baseline/);
  assert.match(script, /Start-Process -FilePath \$upgrade/);
  assert.match(script, /invalid update/);
  assert.match(script, /recovery check/i);
  assert.doesNotMatch(script, /Remove-Item.+(LOCALAPPDATA|APPDATA)/i);
});

test('Supabase cycle smoke uses rollback and verifies idempotency, zero-price and report publication', () => {
  const sql = read('tests/supabase/transactional-cycle-smoke.sql');
  assert.match(sql, /begin;/i);
  assert.match(sql, /rollback;/i);
  assert.match(sql, /set local role authenticated/i);
  assert.match(sql, /create_visit_intake_idempotent/i);
  assert.match(sql, /save_draft_results_idempotent/i);
  assert.match(sql, /selling_price',0/);
  assert.match(sql, /Idempotency key reused with different payload/);
  assert.match(sql, /OFFLINE_PRICE_CONFLICT/);
  assert.match(sql, /publish_report_version/i);
  assert.match(sql, /transaction_rolled_back/);
});

test('Supabase branch isolation smoke verifies allowed and denied branch visibility in a rollback transaction', () => {
  const sql = read('tests/supabase/branch-isolation-smoke.sql');
  assert.match(sql, /rollback;/i);
  assert.match(sql, /private\.can_access_branch/);
  assert.match(sql, /branch_a_patient_visible/);
  assert.match(sql, /branch_b_patient_hidden/);
});
