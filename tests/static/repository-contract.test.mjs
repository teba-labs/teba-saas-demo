import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('../../', import.meta.url).pathname;
const files = [
  'modules/catalog/repository.js',
  'modules/reception/repository.js',
  'modules/expenses/repository.js',
];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(source, /getSupabaseClient/);
  assert.doesNotMatch(source, /khjzoleiuiipyodpkieg/);
  assert.doesNotMatch(source, /service_role/i);
}
const reception = fs.readFileSync(path.join(root, files[1]), 'utf8');
assert.match(reception, /getOpenWorkday/);
assert.match(reception, /recordPatientPayment/);
const expenses = fs.readFileSync(path.join(root, files[2]), 'utf8');
assert.match(expenses, /recordBranchExpense/);
console.log('PASS: Catalog, reception and expense repositories follow the new schema contract and avoid production credentials.');
