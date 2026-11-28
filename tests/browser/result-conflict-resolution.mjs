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
    if (pathname === '/__conflict_test__') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>IndexedDB conflict test</body></html>');
      return;
    }
    const relative = pathname.slice(1);
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(root + path.sep), 'path escaped repository');
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch (error) { res.writeHead(404); res.end(String(error)); }
});
await new Promise(resolve => server.listen(4176, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4176/__conflict_test__');
  const result = await page.evaluate(async () => {
    const { offlineDb } = await import('/offline/database.js');
    const {
      rebaseDraftResultConflict,
      keepServerDraftResultConflict,
    } = await import('/offline/outbox.js');
    await offlineDb.open();

    const tenantId = 'ci-conflict-tenant';
    const branchId = 'ci-conflict-branch';
    const visitTestId = 'ci-rebase-visit-test';
    const operationId = 'ci-rebase-operation';
    const conflictId = 'ci-rebase-conflict';
    const now = new Date().toISOString();
    const localPayload = {
      visit_test_id: visitTestId,
      staff_id: 'ci-staff',
      results: [{ parameter_code: 'GLUCOSE', value_numeric: 90, value_text: null, flag: 'normal' }],
      expected_snapshot: [{ parameter_code: 'GLUCOSE', value_numeric: 80, value_text: null, flag: 'normal' }],
    };
    await offlineDb.outbox.add({
      operation_id: operationId, tenant_id: tenantId, branch_id: branchId,
      entity_type: 'draft_results', action: 'save', payload: localPayload,
      depends_on: [], status: 'conflict', attempts: 0, created_at: now,
      updated_at: now, next_attempt_at: now, lease_until: null, sync_owner: null,
    });
    await offlineDb.conflicts.add({
      conflict_id: conflictId, tenant_id: tenantId, branch_id: branchId,
      operation_id: operationId, entity_type: 'draft_results',
      local_payload: localPayload,
      server_snapshot: [{ id: 'server-base-1', parameter_code: 'GLUCOSE', value_numeric: 100, value_text: null, flag: 'normal' }],
      reason: 'stale result', status: 'open', created_at: now,
    });
    await offlineDb.test_results.add({
      id: 'local-result-1', tenant_id: tenantId, branch_id: branchId,
      visit_test_id: visitTestId, parameter_code: 'GLUCOSE',
      value_numeric: 90, value_text: null, flag: 'normal',
    });

    const rebasedId = await rebaseDraftResultConflict({ tenantId, branchId, conflictId });
    const rebasedOperation = await offlineDb.outbox.where('operation_id').equals(operationId).first();
    const reviewedConflict = await offlineDb.conflicts.where('conflict_id').equals(conflictId).first();
    const retainedLocal = await offlineDb.test_results.where('visit_test_id').equals(visitTestId).first();

    const serverVisitTestId = 'ci-server-visit-test';
    const serverOperationId = 'ci-server-operation';
    const serverConflictId = 'ci-server-conflict';
    const serverPayload = {
      visit_test_id: serverVisitTestId, staff_id: 'ci-staff',
      results: [{ parameter_code: 'INSULIN', value_numeric: 5, value_text: null, flag: 'normal' }],
    };
    await offlineDb.outbox.add({
      operation_id: serverOperationId, tenant_id: tenantId, branch_id: branchId,
      entity_type: 'draft_results', action: 'save', payload: serverPayload,
      depends_on: [], status: 'conflict', attempts: 0, created_at: now,
      updated_at: now, next_attempt_at: now, lease_until: null, sync_owner: null,
    });
    await offlineDb.conflicts.add({
      conflict_id: serverConflictId, tenant_id: tenantId, branch_id: branchId,
      operation_id: serverOperationId, entity_type: 'draft_results',
      local_payload: serverPayload,
      server_snapshot: [{ id: 'server-result-2', parameter_code: 'INSULIN', value_numeric: 7, value_text: null, flag: 'normal' }],
      reason: 'stale result', status: 'open', created_at: now,
    });
    await offlineDb.test_results.add({
      id: 'local-result-2', tenant_id: tenantId, branch_id: branchId,
      visit_test_id: serverVisitTestId, parameter_code: 'INSULIN',
      value_numeric: 5, value_text: null, flag: 'normal',
    });

    const keptId = await keepServerDraftResultConflict({ tenantId, branchId, conflictId: serverConflictId });
    const discardedOperation = await offlineDb.outbox.where('operation_id').equals(serverOperationId).first();
    const resolvedConflict = await offlineDb.conflicts.where('conflict_id').equals(serverConflictId).first();
    const cachedServerRows = await offlineDb.test_results.where('visit_test_id').equals(serverVisitTestId).toArray();

    const output = {
      rebaseOperationIdPreserved: rebasedId === operationId,
      rebaseStatusPending: rebasedOperation?.status === 'pending',
      expectedSnapshotRebasedToServer: rebasedOperation?.payload?.expected_snapshot?.[0]?.value_numeric === 100,
      localDraftPreservedForReview: retainedLocal?.value_numeric === 90,
      conflictMarkedReviewed: reviewedConflict?.status === 'reviewed',
      keepServerOperationIdPreserved: keptId === serverOperationId,
      localOperationDiscarded: !discardedOperation,
      conflictResolved: resolvedConflict?.status === 'resolved'
        && resolvedConflict?.resolution === 'server_snapshot_kept_local_discarded',
      cacheReplacedWithServerSnapshot: cachedServerRows.length === 1
        && cachedServerRows[0].id === 'server-result-2'
        && cachedServerRows[0].value_numeric === 7,
    };
    await offlineDb.delete();
    return output;
  });

  for (const [key, value] of Object.entries(result)) assert.equal(value, true, key);
  console.log(JSON.stringify({ resultConflictResolution: 'passed', ...result }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
