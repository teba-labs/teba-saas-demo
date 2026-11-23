import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const repository = await readFile(new URL('modules/catalog/repository.js', root), 'utf8');
const ui = await readFile(new URL('assets/js/catalog.js', root), 'utf8');
const migration = await readFile(new URL('database/migrations/087_gate_master_catalog_import.sql', root), 'utf8');

test('customer master library exposes only centrally reviewed complete definitions', () => {
  assert.match(repository, /eq\('clinical_review_status','verified'\)/);
  assert.match(repository, /stats\.unreviewed_parameters === 0/);
  assert.match(repository, /stats\.placeholder_parameters === 0/);
  assert.match(repository, /stats\.missing_numeric_ranges === 0/);
  assert.match(repository, /stats\.missing_units === 0/);
  assert.match(repository, /stats\.missing_formulas === 0/);
});

test('central import is guarded on the server and imported copies start inactive', () => {
  assert.match(migration, /not passed central clinical review/);
  assert.match(migration, /parameters, units, reference intervals, formulas or clinical review are incomplete/);
  assert.match(migration, /set is_active = false/);
  assert.match(migration, /Only the tenant owner may import/);
});

test('catalog UI no longer invites customers to complete placeholder definitions', () => {
  assert.match(ui, /مكتملة ومراجعة مركزيًا/);
  assert.match(ui, /التعريفات الناقصة لا تظهر للعميل/);
  assert.doesNotMatch(ui, /استيراد واستكمال محليًا/);
});
