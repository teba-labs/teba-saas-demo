import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/015_branch_outstanding_balances.sql'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'modules/reception/repository.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'assets/js/reception.js'), 'utf8');

test('outstanding balances are computed server-side within the origin branch', () => {
  assert.match(migration, /function public\.list_branch_outstanding_balances/);
  assert.match(migration, /private\.can_access_branch\(p_tenant_id, p_branch_id\)/);
  assert.match(migration, /v\.branch_id = p_branch_id/);
  assert.match(migration, /left join public\.payments py/);
  assert.match(migration, /sum\(py\.amount\)/);
  assert.match(migration, /v\.status <> 'cancelled'/);
  assert.match(migration, /grant execute .* to authenticated/);
  assert.match(repository, /rpc\('list_branch_outstanding_balances'/);
});

test('later collection checks remaining balance and does not print queued payments as final', () => {
  assert.match(page, /amount>remaining/);
  assert.match(page, /recordPayment\(/);
  assert.match(page, /payment\?\.queued/);
  assert.match(page, /لا تطبع إيصالًا نهائيًا قبل التأكيد/);
  assert.match(page, /showPaymentReceipt/);
});
