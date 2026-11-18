import { offlineDb } from './database.js';

const ALLOWED_STATUSES = new Set(['pending', 'syncing', 'failed', 'conflict']);
const DEFAULT_MAX_ATTEMPTS = 12;
const LEASE_MS = 90_000;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('Secure UUID generation is unavailable; refusing to create a non-idempotent operation.');
}

export async function enqueueOperation({ tenantId, branchId, entityType, action, payload, priority = 100, operationId = makeId(), dependsOn = [] }) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required for every offline operation.');
  if (!entityType || !action) throw new Error('entityType and action are required.');
  if (!Array.isArray(dependsOn) || dependsOn.some(id => typeof id !== 'string' || !id)) throw new Error('dependsOn must be an array of operation IDs.');
  const now = new Date().toISOString();
  const operation = {
    operation_id: operationId, tenant_id: tenantId, branch_id: branchId,
    entity_type: entityType, action, payload: structuredClone(payload), priority,
    depends_on: [...new Set(dependsOn)], status: 'pending', attempts: 0,
    created_at: now, updated_at: now, next_attempt_at: now,
    lease_until: null, sync_owner: null, last_error: null,
  };
  await offlineDb.outbox.add(operation);
  return operation.operation_id;
}

async function recoverExpiredLeases(now, { tenantId, branchId }) {
  // Recover only the selected tenant/branch. A sync started for one lab must not
  // mutate another lab's local queue, even when both share this browser database.
  const stale = await offlineDb.outbox.where('status').equals('syncing').toArray();
  for (const item of stale) {
    if (item.tenant_id === tenantId && item.branch_id === branchId
        && (!item.lease_until || item.lease_until <= now)) {
      await offlineDb.outbox.update(item.local_id, {
        status: 'pending', lease_until: null, sync_owner: null,
        next_attempt_at: now, updated_at: now,
      });
    }
  }
}

async function dependencyReady(item) {
  for (const operationId of item.depends_on ?? []) {
    const acknowledged = await offlineDb.sync_meta.get(`ack:${operationId}`);
    if (!acknowledged) return false;
  }
  return true;
}

async function claimOperation(item, owner, now) {
  return offlineDb.transaction('rw', offlineDb.outbox, async () => {
    const current = await offlineDb.outbox.get(item.local_id);
    if (!current || !['pending', 'failed'].includes(current.status) || current.next_attempt_at > now) return false;
    await offlineDb.outbox.update(item.local_id, {
      status: 'syncing', sync_owner: owner,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: now,
    });
    return true;
  });
}

/** A handler must return { acknowledged: true } only after a server-confirmed, idempotent write. */
export async function syncOutbox({ handlers, maxAttempts = DEFAULT_MAX_ATTEMPTS, onProgress = () => {}, tenantId, branchId } = {}) {
  if (!handlers || typeof handlers !== 'object') throw new Error('Explicit sync handlers are required.');
  if (typeof tenantId !== 'string' || !tenantId || typeof branchId !== 'string' || !branchId) {
    throw new Error('A tenant and branch must be selected before synchronizing offline operations.');
  }
  if (globalThis.navigator && navigator.onLine === false) return { acknowledged: 0, retained: 0, conflicts: 0, offline: true };
  const run = async () => {
    const now = new Date().toISOString();
    await recoverExpiredLeases(now, { tenantId, branchId });
    let candidates = await offlineDb.outbox.where('status').anyOf('pending', 'failed').toArray();
    candidates = candidates.filter(item => item.tenant_id === tenantId && item.branch_id === branchId);
    candidates.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    const report = { acknowledged: 0, retained: 0, conflicts: 0, blocked: 0, total: candidates.length };
    const owner = makeId();

    for (const item of candidates) {
      if (item.attempts >= maxAttempts) continue;
      if (!(await dependencyReady(item))) { report.blocked++; continue; }
      if (!(await claimOperation(item, owner, new Date().toISOString()))) continue;
      const handler = handlers[item.entity_type];
      if (typeof handler !== 'function') {
        report.retained++;
        await markFailure(item, `No sync handler registered for ${item.entity_type}.`, maxAttempts);
        continue;
      }
      try {
        const result = await handler(structuredClone(item));
        if (result?.conflict === true) {
          await offlineDb.transaction('rw', offlineDb.outbox, offlineDb.conflicts, async () => {
            await offlineDb.conflicts.add({
              conflict_id: makeId(), tenant_id: item.tenant_id, branch_id: item.branch_id,
              operation_id: item.operation_id, entity_type: item.entity_type,
              local_payload: item.payload, server_snapshot: result.serverSnapshot ?? null,
              reason: result.reason ?? 'Server reported a conflict.', status: 'open',
              created_at: new Date().toISOString(),
            });
            await offlineDb.outbox.update(item.local_id, { status: 'conflict', lease_until: null, sync_owner: null, updated_at: new Date().toISOString() });
          });
          report.conflicts++;
        } else if (result?.acknowledged === true) {
          await offlineDb.transaction('rw', offlineDb.outbox, offlineDb.sync_meta, async () => {
            await offlineDb.sync_meta.put({ key: `ack:${item.operation_id}`, tenant_id: item.tenant_id, branch_id: item.branch_id, acknowledged_at: new Date().toISOString(), entity_type: item.entity_type });
            await offlineDb.outbox.delete(item.local_id);
          });
          report.acknowledged++;
        } else {
          throw new Error('Handler did not confirm server acknowledgement; operation retained.');
        }
      } catch (error) {
        report.retained++;
        await markFailure(item, error?.message || String(error), maxAttempts);
      }
      try { onProgress({ ...report, operationId: item.operation_id }); } catch { /* progress UI must not interrupt durable sync */ }
    }
    return report;
  };

  // Web Locks coordinates tabs where supported; IDB transactions still protect each claim.
  if (globalThis.navigator?.locks?.request) return navigator.locks.request('taiba-smart-lab-outbox-sync', run);
  return run();
}

async function markFailure(item, message, maxAttempts) {
  const attempts = (item.attempts || 0) + 1;
  const delayMs = Math.min(30_000 * (2 ** Math.min(attempts, 7)), 60 * 60 * 1000);
  const next = new Date(Date.now() + delayMs).toISOString();
  await offlineDb.outbox.update(item.local_id, {
    status: attempts >= maxAttempts ? 'failed' : 'pending', attempts,
    last_error: String(message).slice(0, 1000), next_attempt_at: next,
    lease_until: null, sync_owner: null, updated_at: new Date().toISOString(),
  });
}

export async function getOutboxSummary({ tenantId, branchId } = {}) {
  let rows = await offlineDb.outbox.toArray();
  if (tenantId) rows = rows.filter(row => row.tenant_id === tenantId);
  if (branchId) rows = rows.filter(row => row.branch_id === branchId);
  return rows.reduce((summary, row) => {
    if (!ALLOWED_STATUSES.has(row.status)) summary.invalid++;
    else summary[row.status]++;
    summary.total++;
    return summary;
  }, { pending: 0, syncing: 0, failed: 0, conflict: 0, invalid: 0, total: 0 });
}

export async function listOpenConflicts({ tenantId, branchId } = {}) {
  let rows = await offlineDb.conflicts.where('status').equals('open').toArray();
  if (tenantId) rows = rows.filter(row => row.tenant_id === tenantId);
  if (branchId) rows = rows.filter(row => row.branch_id === branchId);
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function retryFailedOperations({ tenantId, branchId } = {}) {
  let rows = await offlineDb.outbox.where('status').equals('failed').toArray();
  if (tenantId) rows = rows.filter(row => row.tenant_id === tenantId);
  if (branchId) rows = rows.filter(row => row.branch_id === branchId);
  for (const row of rows) await offlineDb.outbox.update(row.local_id, { status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() });
  return rows.length;
}
