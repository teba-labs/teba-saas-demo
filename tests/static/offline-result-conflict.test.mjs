import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');

test('draft result saves carry the exact values observed when the result form was loaded', () => {
  const ui = read('assets/js/results-workbench.js');
  const repository = read('modules/results/repository.js');
  assert.match(ui, /input\.dataset\.originalFlag=result\.flag/);
  assert.match(ui, /const expectedSnapshot = submittedInputs\.map/);
  assert.match(ui, /value_numeric: original && numeric \? Number\(original\) : null/);
  assert.match(ui, /value_text: original && !numeric \? original : null/);
  assert.match(ui, /expectedSnapshot,/);
  assert.match(repository, /expected_snapshot: expectedSnapshot/);
  assert.match(repository, /save_draft_results_idempotent_v2/);
});

test('the sync adapter uses compare-and-set and preserves conflicting operations for review', () => {
  const adapter = read('offline/supabase-adapters.js');
  const outbox = read('offline/outbox.js');
  assert.match(adapter, /save_draft_results_idempotent_v2/);
  assert.match(adapter, /p_expected_snapshot: p\.expected_snapshot/);
  assert.match(adapter, /OFFLINE_RESULTS_CONFLICT/);
  assert.match(adapter, /serverSnapshot: latest\.error \? null : latest\.data/);
  assert.match(outbox, /status: 'conflict'/);
  assert.match(outbox, /server_snapshot: result\.serverSnapshot/);
  assert.match(outbox, /status: 'resolved'/);
});

test('migration compares each submitted parameter under the visit lock before writing', () => {
  const migration = read('database/migrations/139_offline_result_compare_and_set_enforcement.sql');
  assert.match(migration, /save_draft_results_idempotent_v2/);
  assert.match(migration, /p_expected_snapshot jsonb/);
  assert.match(migration, /for update of v,vt/i);
  assert.match(migration, /OFFLINE_RESULTS_CONFLICT/);
  assert.match(migration, /save_draft_results_atomic\(/);
  assert.match(migration, /legacy result save cannot overwrite an existing value/);
  assert.match(migration, /revoke all on function public\.save_draft_results_atomic[\s\S]*authenticated/i);
  assert.match(migration, /create trigger trg_guard_test_result_mutation_compare_and_set/i);
  assert.match(migration, /before insert or update or delete on public\.test_results/i);
  assert.match(migration, /current_user='authenticated'/);
  assert.match(migration, /Employee accounts may only act as their own linked active staff identity/);
  assert.match(migration, /set_config\('app\.result_write_authorized','on',true\)/);
  assert.match(migration, /correct_completed_visit_result[\s\S]*set_config\('app\.result_correction','on',true\)/);
  assert.match(migration, /correct_visit_result_with_flag[\s\S]*set_config\('app\.result_correction','on',true\)/);
  assert.match(migration, /set_visit_parameter_range_override[\s\S]*set_config\('app\.result_correction','on',true\)/);
  assert.match(migration, /correct_published_result[\s\S]*private\.is_tenant_owner/);
  assert.match(migration, /set_config\('app\.result_write_authorized','off',true\)/);
  assert.match(read('tests/supabase/result-conflict-smoke.sql'), /direct table UPDATE bypassed compare-and-set/);
  assert.match(read('tests/supabase/result-conflict-smoke.sql'), /direct table INSERT bypassed result protection/);
  const rollback = read('database/rollbacks/139_offline_result_compare_and_set_enforcement.sql');
  assert.match(rollback, /drop function if exists public\.save_draft_results_idempotent_v2/);
  assert.match(rollback, /revoke all on function public\.save_draft_results_atomic[\s\S]*authenticated/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(rollback, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(rollback, /delete from public\.test_results|update public\.test_results/i);
  assert.match(read('tests/supabase/result-conflict-smoke.sql'), /all_changes_rolled_back/);
});

test('the deployable Supabase migration matches the reviewed database migration', () => {
  const additive = read('database/migrations/137_offline_result_compare_and_set.sql');
  const supabaseAdditive = read('supabase/migrations/20261128105005_offline_result_compare_and_set_additive.sql');
  assert.equal(supabaseAdditive, additive);
  const acl = read('database/migrations/138_offline_result_compare_and_set_additive_acl.sql');
  const supabaseAcl = read('supabase/migrations/20261128105202_offline_result_compare_and_set_additive_acl.sql');
  assert.equal(supabaseAcl, acl);
  assert.match(acl, /revoke all on function public\.save_draft_results_idempotent_v2[\s\S]*from public, anon/i);
  assert.match(acl, /grant execute on function public\.save_draft_results_idempotent_v2[\s\S]*to authenticated/i);
  const enforcement = read('database/migrations/139_offline_result_compare_and_set_enforcement.sql');
  const supabaseEnforcement = read('supabase/migrations/20261128110000_offline_result_compare_and_set_enforcement.sql');
  assert.equal(supabaseEnforcement, enforcement);
});

test('legacy queued draft results without an expected snapshot are retained for explicit server review', () => {
  const adapter = read('offline/supabase-adapters.js');
  assert.match(adapter, /if \(!Array\.isArray\(p\.expected_snapshot\)\)/);
  assert.match(adapter, /legacy queues predate expected_snapshot|Main-era offline queues predate expected_snapshot/);
  assert.match(adapter, /serverSnapshot: latest\.data \|\| \[\]/);
  assert.match(adapter, /if \(latest\.error\) throw latest\.error/);
});
