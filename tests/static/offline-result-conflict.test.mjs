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
  const migration = read('database/migrations/137_offline_result_compare_and_set.sql');
  assert.match(migration, /save_draft_results_idempotent_v2/);
  assert.match(migration, /p_expected_snapshot jsonb/);
  assert.match(migration, /for update of v,vt/i);
  assert.match(migration, /OFFLINE_RESULTS_CONFLICT/);
  assert.match(migration, /save_draft_results_atomic\(/);
  assert.match(migration, /legacy result save cannot overwrite an existing value/);
  assert.match(migration, /revoke all on function public\.save_draft_results_atomic[\s\S]*authenticated/i);
  assert.doesNotMatch(migration, /delete from public\.test_results|update public\.test_results/i);
  const rollback = read('database/rollbacks/137_offline_result_compare_and_set.sql');
  assert.match(rollback, /drop function if exists public\.save_draft_results_idempotent_v2/);
  assert.match(rollback, /revoke all on function public\.save_draft_results_atomic[\s\S]*authenticated/i);
  assert.doesNotMatch(rollback, /delete from public\.test_results|update public\.test_results/i);
  assert.match(read('tests/supabase/result-conflict-smoke.sql'), /all_changes_rolled_back/);
});

test('the deployable Supabase migration matches the reviewed database migration', () => {
  const database = read('database/migrations/137_offline_result_compare_and_set.sql');
  const supabase = read('supabase/migrations/20261128100000_offline_result_compare_and_set.sql');
  assert.equal(supabase, database);
});
