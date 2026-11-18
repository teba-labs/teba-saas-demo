import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/011_idempotent_cash_replay_hardening.sql'), 'utf8');

function functionBody(name) {
  const start = sql.indexOf(`function public.${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return sql.slice(start, end);
}

test('payment replay is checked before mutable staff and workday validation', () => {
  const body = functionBody('record_patient_payment');
  const replay = body.indexOf('from public.payments');
  const staff = body.indexOf('from public.staff_directory');
  const workday = body.indexOf('from public.branch_workdays');
  assert.ok(replay >= 0 && replay < staff && replay < workday);
  for (const field of ['branch_id', 'visit_id', 'amount', 'payment_method', 'received_by_staff_id', 'notes']) {
    assert.match(body, new RegExp(`v_existing\\.${field} is distinct from`));
  }
  assert.match(body, /p_idempotency_key is null/);
  assert.match(body, /for update/);
});

test('expense replay is checked before mutable staff, category and workday validation', () => {
  const body = functionBody('record_branch_expense');
  const replay = body.indexOf('from public.expenses');
  const staff = body.indexOf('from public.staff_directory');
  const category = body.indexOf('from public.expense_categories');
  const workday = body.indexOf('from public.branch_workdays');
  assert.ok(replay >= 0 && replay < staff && replay < category && replay < workday);
  for (const field of ['branch_id', 'category_id', 'amount', 'description', 'spent_by_staff_id']) {
    assert.match(body, new RegExp(`v_existing\\.${field} is distinct from`));
  }
  assert.match(body, /p_idempotency_key is null/);
});

test('cash RPC grants remain authenticated-only', () => {
  assert.match(sql, /revoke all on function public\.record_patient_payment[\s\S]*?from public, anon/);
  assert.match(sql, /grant execute on function public\.record_patient_payment[\s\S]*?to authenticated/);
  assert.match(sql, /revoke all on function public\.record_branch_expense[\s\S]*?from public, anon/);
  assert.match(sql, /grant execute on function public\.record_branch_expense[\s\S]*?to authenticated/);
});
