import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const outbox = fs.readFileSync(new URL('../../offline/outbox.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../../assets/js/sync-center.js', import.meta.url), 'utf8');

test('conflict retry is scoped and preserves the original idempotency key', () => {
  assert.match(outbox, /retryConflictOperation/);
  assert.match(outbox, /conflict\.tenant_id !== tenantId \|\| conflict\.branch_id !== branchId/);
  assert.match(outbox, /operation\.operation_id/);
  assert.match(outbox, /status: 'pending', attempts: 0/);
});

test('a server acknowledgement resolves the matching local conflict history', () => {
  assert.match(outbox, /status: 'resolved', resolution: 'server_acknowledged'/);
  assert.match(outbox, /conflict\.operation_id === item\.operation_id/);
});

test('repeated conflict retries update one conflict record instead of creating duplicates', () => {
  assert.match(outbox, /history\.find\(row => row\.operation_id === item\.operation_id/);
  assert.match(outbox, /if \(previous\) await offlineDb\.conflicts\.update/);
});

test('sync center displays both local and server snapshots before offering a safe retry', () => {
  assert.match(ui, /local_payload/);
  assert.match(ui, /server_snapshot/);
  assert.match(ui, /data-retry-conflict/);
  assert.match(ui, /retryConflictOperation/);
  assert.match(ui, /same|بنفس رقمها الآمن/);
});

test('patient ID collision includes a scoped server snapshot when RLS allows the read', () => {
  const adapters = fs.readFileSync(new URL('../../offline/supabase-adapters.js', import.meta.url), 'utf8');
  assert.match(adapters, /serverSnapshot: existing\.data \?\? null/);
  assert.match(adapters, /existing\.data\.tenant_id !== operation\.tenant_id/);
  assert.match(adapters, /existing\.data\.branch_id !== operation\.branch_id/);
});
