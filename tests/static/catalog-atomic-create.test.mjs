import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('individual catalog test and default parameter are inserted atomically and idempotently', () => {
  const migration = read('database/migrations/119_atomic_catalog_test_and_default_parameter.sql');
  const repository = read('modules/catalog/repository.js');
  const catalogPage = read('assets/js/catalog.js');
  const contract = read('core/data/schema-contract.js');
  assert.match(migration, /create or replace function public\.create_catalog_test_with_default_parameter/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /private\.is_tenant_member\(p_tenant_id\)/);
  assert.match(migration, /jsonb_populate_record/);
  assert.match(migration, /v_existing_test/);
  assert.match(migration, /v_existing_parameter/);
  assert.match(migration, /create_catalog_test_with_default_parameter\(uuid,jsonb,jsonb\)/);
  assert.match(migration, /return jsonb_build_object\('test',to_jsonb\(v_test\),'parameter',to_jsonb\(v_parameter\)\)/);
  assert.match(repository, /RPC\.createCatalogTestWithDefaultParameter/);
  assert.match(repository, /initialParameterSaved: true/);
  assert.match(catalogPage, /initialParameter:isNew&&testKind==='individual'/);
  assert.match(catalogPage, /saved\.queued\)/);
  assert.match(contract, /createCatalogTestWithDefaultParameter: 'create_catalog_test_with_default_parameter'/);
});
