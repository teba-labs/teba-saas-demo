import { offlineDb } from './database.js';

const ALLOWED_STATUSES = new Set(['pending', 'syncing', 'failed', 'conflict']);
const DEFAULT_MAX_ATTEMPTS = 12;
const LEASE_MS = 90_000;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('Secure UUID generation is unavailable; refusing to create a non-idempotent operation.');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function enqueueOperation({ tenantId, branchId, entityType, action, payload, priority = 100, operationId = makeId(), dependsOn = [] }) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required for every offline operation.');
  if (!entityType || !action) throw new Error('entityType and action are required.');
  if (!Array.isArray(dependsOn) || dependsOn.some(id => typeof id !== 'string' || !id)) throw new Error('dependsOn must be an array of operation IDs.');
  const safePayload = structuredClone(payload);
  const dependencies = [...new Set(dependsOn)];
  const now = new Date().toISOString();
  const operation = {
    operation_id: operationId, tenant_id: tenantId, branch_id: branchId,
    entity_type: entityType, action, payload: safePayload, priority,
    depends_on: dependencies, status: 'pending', attempts: 0,
    created_at: now, updated_at: now, next_attempt_at: now,
    lease_until: null, sync_owner: null, last_error: null,
  };

  // Repeated enqueue calls with the same operation ID are safe only when the
  // complete business payload and scope are identical.
  return offlineDb.transaction('rw', offlineDb.outbox, async () => {
    const existing = await offlineDb.outbox.where('operation_id').equals(operationId).first();
    if (existing) {
      const sameOperation = existing.tenant_id === tenantId
        && existing.branch_id === branchId
        && existing.entity_type === entityType
        && existing.action === action
        && stableJson(existing.payload) === stableJson(safePayload)
        && stableJson(existing.depends_on ?? []) === stableJson(dependencies);
      if (!sameOperation) throw new Error('Offline operation ID was reused with different scope or payload.');
      return existing.operation_id;
    }
    await offlineDb.outbox.add(operation);
    return operation.operation_id;
  });
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
    if (!acknowledged || acknowledged.tenant_id !== item.tenant_id || acknowledged.branch_id !== item.branch_id) return false;
  }
  return true;
}

async function claimOperation(item, owner, now) {
  return offlineDb.transaction('rw', offlineDb.outbox, async () => {
    const current = await offlineDb.outbox.get(item.local_id);
    if (!current || current.operation_id !== item.operation_id
        || current.tenant_id !== item.tenant_id || current.branch_id !== item.branch_id
        || !['pending', 'failed'].includes(current.status) || current.next_attempt_at > now) return false;
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
        const retained = await markFailure(item, `No sync handler registered for ${item.entity_type}.`, maxAttempts, owner);
        if (retained) report.retained++; else report.blocked++;
        continue;
      }
      try {
        const result = await handler(structuredClone(item));
        if (result?.conflict === true) {
          const applied = await offlineDb.transaction('rw', offlineDb.outbox, offlineDb.conflicts, async () => {
            const current = await offlineDb.outbox.get(item.local_id);
            if (!current || current.status !== 'syncing' || current.sync_owner !== owner
                || current.operation_id !== item.operation_id) return false;
            const history = await offlineDb.conflicts.toArray();
            const previous = history.find(row => row.operation_id === item.operation_id
              && row.tenant_id === item.tenant_id && row.branch_id === item.branch_id);
            const conflictPatch = {
              entity_type: item.entity_type, local_payload: item.payload,
              server_snapshot: result.serverSnapshot ?? null,
              reason: result.reason ?? 'Server reported a conflict.',
              status: 'open', last_checked_at: new Date().toISOString(),
            };
            if (previous) await offlineDb.conflicts.update(previous.local_id, conflictPatch);
            else await offlineDb.conflicts.add({
              conflict_id: makeId(), tenant_id: item.tenant_id, branch_id: item.branch_id,
              operation_id: item.operation_id, ...conflictPatch,
              created_at: new Date().toISOString(),
            });
            await offlineDb.outbox.update(item.local_id, { status: 'conflict', lease_until: null, sync_owner: null, updated_at: new Date().toISOString() });
            return true;
          });
          if (applied) report.conflicts++; else report.blocked++;
        } else if (result?.acknowledged === true) {
          const applied = await offlineDb.transaction('rw', offlineDb.outbox, offlineDb.sync_meta, offlineDb.conflicts, async () => {
            const current = await offlineDb.outbox.get(item.local_id);
            if (!current || current.status !== 'syncing' || current.sync_owner !== owner
                || current.operation_id !== item.operation_id) return false;
            const acknowledgedAt = new Date().toISOString();
            await offlineDb.sync_meta.put({ key: `ack:${item.operation_id}`, tenant_id: item.tenant_id, branch_id: item.branch_id, acknowledged_at: acknowledgedAt, entity_type: item.entity_type });
            await offlineDb.outbox.delete(item.local_id);
            const history = await offlineDb.conflicts.toArray();
            for (const conflict of history) {
              if (conflict.operation_id === item.operation_id
                  && conflict.tenant_id === item.tenant_id && conflict.branch_id === item.branch_id) {
                await offlineDb.conflicts.update(conflict.local_id, {
                  status: 'resolved', resolution: 'server_acknowledged',
                  resolved_at: acknowledgedAt,
                });
              }
            }
            return true;
          });
          if (applied) report.acknowledged++; else report.blocked++;
        } else {
          throw new Error('Handler did not confirm server acknowledgement; operation retained.');
        }
      } catch (error) {
        const retained = await markFailure(item, error?.message || String(error), maxAttempts, owner);
        if (retained) report.retained++; else report.blocked++;
      }
      try { onProgress({ ...report, operationId: item.operation_id }); } catch { /* progress UI must not interrupt durable sync */ }
    }
    return report;
  };

  // Web Locks coordinates tabs where supported; IDB transactions still protect each claim.
  if (globalThis.navigator?.locks?.request) return navigator.locks.request('taiba-smart-lab-outbox-sync', run);
  return run();
}

async function markFailure(item, message, maxAttempts, owner) {
  return offlineDb.transaction('rw', offlineDb.outbox, async () => {
    const current = await offlineDb.outbox.get(item.local_id);
    if (!current || current.status !== 'syncing' || current.sync_owner !== owner
        || current.operation_id !== item.operation_id) return false;
    const attempts = (current.attempts || 0) + 1;
    const delayMs = Math.min(30_000 * (2 ** Math.min(attempts, 7)), 60 * 60 * 1000);
    const next = new Date(Date.now() + delayMs).toISOString();
    await offlineDb.outbox.update(item.local_id, {
      status: attempts >= maxAttempts ? 'failed' : 'pending', attempts,
      last_error: String(message).slice(0, 1000), next_attempt_at: next,
      lease_until: null, sync_owner: null, updated_at: new Date().toISOString(),
    });
    return true;
  });
}

export async function getOutboxSummary({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('Tenant and branch are required to view offline queue status.');
  let rows = await offlineDb.outbox.toArray();
  rows = rows.filter(row => row.tenant_id === tenantId && row.branch_id === branchId);
  return rows.reduce((summary, row) => {
    if (!ALLOWED_STATUSES.has(row.status)) summary.invalid++;
    else summary[row.status]++;
    summary.total++;
    return summary;
  }, { pending: 0, syncing: 0, failed: 0, conflict: 0, invalid: 0, total: 0 });
}

/** Return queued draft-result batches for the selected branch so the workbench can restore unsynced values after navigation/reload. */
export async function listPendingDraftResults({ tenantId, branchId, visitTestId } = {}) {
  if (!tenantId || !branchId) throw new Error('Tenant and branch are required to read pending draft results.');
  const rows = await offlineDb.outbox.where('entity_type').equals('draft_results').toArray();
  return rows.filter(row => row.tenant_id === tenantId && row.branch_id === branchId
    && (!visitTestId || row.payload?.visit_test_id === visitTestId)
    && ['pending', 'syncing', 'failed', 'conflict'].includes(row.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listOpenConflicts({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('Tenant and branch are required to view offline conflicts.');
  let rows = await offlineDb.conflicts.where('status').equals('open').toArray();
  rows = rows.filter(row => row.tenant_id === tenantId && row.branch_id === branchId);
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Requeue a conflicted operation with its original idempotency key after the user has reviewed the conflict and corrected its cause. */
export async function retryConflictOperation({ tenantId, branchId, conflictId } = {}) {
  if (!tenantId || !branchId || !conflictId) throw new Error('Tenant, branch and conflict are required to retry a conflict.');
  return offlineDb.transaction('rw', offlineDb.outbox, offlineDb.conflicts, async () => {
    const conflict = await offlineDb.conflicts.where('conflict_id').equals(conflictId).first();
    if (!conflict || conflict.tenant_id !== tenantId || conflict.branch_id !== branchId || conflict.status !== 'open') {
      throw new Error('Conflict was not found in the selected tenant and branch, or is no longer open.');
    }
    const operation = await offlineDb.outbox.where('operation_id').equals(conflict.operation_id).first();
    if (!operation || operation.tenant_id !== tenantId || operation.branch_id !== branchId || operation.status !== 'conflict') {
      throw new Error('The original offline operation is unavailable or has already been queued.');
    }
    const now = new Date().toISOString();
    await offlineDb.outbox.update(operation.local_id, {
      status: 'pending', attempts: 0, next_attempt_at: now, last_error: null,
      lease_until: null, sync_owner: null, updated_at: now,
    });
    return operation.operation_id;
  });
}

export async function retryFailedOperations({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('Tenant and branch are required to retry offline operations.');
  let rows = await offlineDb.outbox.where('status').equals('failed').toArray();
  rows = rows.filter(row => row.tenant_id === tenantId && row.branch_id === branchId);
  for (const row of rows) await offlineDb.outbox.update(row.local_id, { status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() });
  return rows.length;
}
