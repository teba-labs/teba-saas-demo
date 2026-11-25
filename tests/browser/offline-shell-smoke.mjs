import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'app/index.html' : pathname.slice(1);
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(root + path.sep), 'path escaped repository');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) { res.writeHead(404); res.end(String(error)); }
});
await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('http://127.0.0.1:4174/app/sync-center.html', { waitUntil: 'load', timeout: 90000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
  await page.reload({ waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const database = await import('/offline/database.js');
    await database.assertOfflineDatabaseReady();
    await database.offlineDb.sync_meta.put({
      key: 'ci-offline-smoke',
      value: { persisted: true, created_at: new Date().toISOString() },
    });
    await database.offlineDb.outbox.add({
      operation_id: 'ci-offline-reload-operation',
      tenant_id: 'ci-tenant',
      branch_id: 'ci-branch',
      entity_type: 'ci-smoke',
      action: 'offline-reload',
      payload: { patient: 'offline-only', value: 42 },
      depends_on: [],
      status: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      lease_until: null,
      sync_owner: null,
      last_error: null,
    });
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  const result = await page.evaluate(async () => {
    const database = await import('/offline/database.js');
    const row = await database.offlineDb.sync_meta.get('ci-offline-smoke');
    const pending = await database.offlineDb.outbox.where('operation_id').equals('ci-offline-reload-operation').first();
    return { persisted: row?.value?.persisted === true, pendingOperations: pending ? 1 : 0 };
  });
  assert.equal(result.persisted, true, 'IndexedDB record did not survive offline reload');
  assert.equal(result.pendingOperations, 1, 'Outbox operation did not survive offline reload');
  assert.deepEqual(pageErrors, [], 'browser module errors occurred during offline reload');

  await page.evaluate(async () => {
    const database = await import('/offline/database.js');
    await database.offlineDb.sync_meta.delete('ci-offline-smoke');
    await database.offlineDb.outbox.where('operation_id').equals('ci-offline-reload-operation').delete();
  });
  console.log(JSON.stringify({ offlineShell: 'loaded from service-worker cache', indexedDbReload: 'passed', pendingQueuePersistence: 'passed', pendingAfterReload: result.pendingOperations }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
