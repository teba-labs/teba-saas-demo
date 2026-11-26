import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const catalog = read('modules/catalog/repository.js');
const adapters = read('offline/supabase-adapters.js');
const syncUi = read('assets/js/sync-center.js');
const syncHtml = read('app/sync-center.html');
const catalogUi = read('assets/js/catalog.js');

test('catalog test and parameter edits queue locally when offline instead of requiring the network', () => {
  assert.match(catalog, /queueCatalogChange/);
  assert.match(catalog, /entityType: 'catalog_change'/);
  assert.match(catalog, /globalThis\.navigator\?\.onLine === false/);
  assert.match(catalogUi, /branchId:state\.tenant\.branches\?\.\[0\]\?\.id/);
  const editHandlers = catalogUi.slice(catalogUi.indexOf("$('testForm')"), catalogUi.indexOf("$('masterCatalogSearch')"));
  assert.doesNotMatch(editHandlers, /requireOnline\(\)/);
});

test('offline catalog proposals preserve their base version and local dependency order', () => {
  assert.match(catalog, /base_updated_at: baseSnapshot\?\.local_base_updated_at \?\? baseSnapshot\?\.updated_at/);
  assert.match(catalog, /base_snapshot: baseSnapshot/);
  assert.match(catalog, /dependsOn: dependencies/);
  assert.match(catalog, /baseSnapshot\?\.local_operation_id/);
});

test('each device uploads its proposal using the original operation ID and a server snapshot', () => {
  assert.match(adapters, /catalog_change: async operation/);
  assert.match(adapters, /id: operation\.operation_id/);
  assert.match(adapters, /operation_id: operation\.operation_id/);
  assert.match(adapters, /server_payload: currentResult\.data \|\| \{\}/);
  assert.match(adapters, /entity_type: p\.kind === 'test' \? 'catalog_test_change'/);
  assert.match(adapters, /resolution === 'approved'/);
});

test('catalog approval is guarded by the base updated_at and never silently overwrites a newer row', () => {
  assert.match(catalog, /current\.updated_at !== expectedVersion/);
  assert.match(catalog, /eq\('updated_at', expectedVersion\)/);
  assert.match(catalog, /resolution: 'conflict'/);
  assert.match(catalog, /resolution: 'approved'/);
});

test('Sync Center lists cloud proposals and requires an explicit approve or reject decision', () => {
  assert.match(catalog, /listPendingCatalogChanges/);
  assert.match(catalog, /resolveCatalogChangeProposal/);
  assert.match(syncUi, /data-approve-catalog-change/);
  assert.match(syncUi, /data-reject-catalog-change/);
  assert.match(syncHtml, /id="catalogChanges"/);
});
