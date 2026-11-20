import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog distinguishes individual tests from panels and preserves kind in visit snapshots', () => {
  const html = read('app/catalog.html');
  const js = read('assets/js/catalog.js');
  const repo = read('modules/catalog/repository.js');
  const sql = read('database/migrations/033_catalog_test_kind.sql');
  assert.match(html, /id="testKind"/);
  assert.match(html, /تحليل فردي/);
  assert.match(html, /مجموعة تحاليل/);
  assert.match(js, /testKind/);
  assert.match(js, /testKind==='individual'/);
  assert.match(js, /RES_\$\{saved\.code\}/);
  assert.match(repo, /test_kind: testKind/);
  assert.match(repo, /test_kind, category/);
  assert.match(sql, /test_kind in \('individual','panel'\)/);
  assert.match(sql, /technical_snapshot/);
  assert.match(sql, /before insert on public\.visit_tests/);
});

test('new individual tests receive one distinct result parameter automatically; panels remain configurable', () => {
  const js = read('assets/js/catalog.js');
  assert.match(js, /if\(isNew&&testKind==='individual'\)/);
  assert.match(js, /saveTestParameter\(/);
  assert.match(js, /parameterRanges/);
});
