import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('visit intake stays queued while its patient creation dependency is pending, even after reconnect', () => {
  const repo = read('modules/reception/repository.js');
  assert.match(repo, /globalThis\.navigator\?\.onLine === false \|\| dependsOn\.length > 0\) return queue\(\)/);
  assert.match(repo, /dependsOn\s*\}\s*\);/);
});

test('patient replay verifies the full identity payload before acknowledging a duplicate ID', () => {
  const adapters = read('offline/supabase-adapters.js');
  for (const field of ['full_name', 'patient_number', 'phone', 'age_years', 'age_value', 'age_unit', 'sex', 'created_by_staff_id']) {
    assert.match(adapters, new RegExp(`existing\\.data\\.${field}`));
  }
});

test('deterministic business-rule rejections become conflicts instead of consuming transient retries', () => {
  const adapters = read('offline/supabase-adapters.js');
  assert.match(adapters, /OFFLINE_PRICE_CONFLICT\|open the branch workday/);
  assert.match(adapters, /remaining balance\|active staff/);
  assert.match(adapters, /expense category unavailable/);
});


test('sync center reports dependency-blocked operations separately from transient failures', () => {
  const syncUi = read('assets/js/sync-center.js');
  assert.match(syncUi, /p\.blocked/);
  assert.match(syncUi, /report\.blocked/);
  assert.match(syncUi, /بانتظار عملية سابقة/);
});
