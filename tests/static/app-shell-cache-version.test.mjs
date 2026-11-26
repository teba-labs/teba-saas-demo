import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('app shell cache is invalidated after doctor text editors and tenant onboarding change', () => {
  const sw = read('service-worker.js');
  const version = Number(sw.match(/taiba-smart-lab-shell-v(\\d+)/)?.[1] || 0);
  assert.ok(version > 77, 'service worker cache version must advance beyond the previous production shell');
  for (const asset of ['./app/catalog.html','./app/platform-admin.html','./assets/js/catalog.js','./assets/js/platform-admin.js','./modules/catalog/repository.js']) {
    assert.ok(sw.includes(asset), 'missing refreshed shell asset: ' + asset);
  }
});
