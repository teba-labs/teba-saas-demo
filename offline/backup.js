import { offlineDb } from './database.js';

const FORMAT = 'taiba-smart-lab-local-backup';
const VERSION = 1;
const TABLES = ['patients', 'visits', 'visit_tests', 'test_results', 'catalog', 'test_prices', 'test_parameters', 'staff_directory', 'workdays', 'expense_categories', 'financial_ledger', 'daily_closings', 'outbox', 'conflicts', 'sync_meta'];

async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure checksum is unavailable in this browser context.');
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function belongsToScope(row, tenantId, branchId) {
  return row.tenant_id === tenantId && (!row.branch_id || row.branch_id === branchId);
}

export async function exportLocalBackup({ tenantId, branchId, tenantName = '', branchName = '' } = {}) {
  if (!tenantId || !branchId) throw new Error('Choose a tenant and branch before exporting a local backup.');
  await offlineDb.open();
  const tables = {};
  for (const name of TABLES) {
    const rows = await offlineDb.table(name).toArray();
    tables[name] = rows.filter(row => name === 'sync_meta' ? row.tenant_id === tenantId && row.branch_id === branchId : belongsToScope(row, tenantId, branchId));
  }
  const document = {
    format: FORMAT, version: VERSION, exported_at: new Date().toISOString(),
    scope: { tenant_id: tenantId, branch_id: branchId, tenant_name: tenantName, branch_name: branchName },
    coverage: 'local-device-cache-and-pending-operations-only', tables,
  };
  const canonical = JSON.stringify(document);
  return { ...document, checksum_sha256: await sha256(canonical) };
}

export async function restoreLocalBackup(document, { tenantId, branchId } = {}) {
  if (!document || document.format !== FORMAT || document.version !== VERSION) throw new Error('Unsupported backup file format or version.');
  if (document.scope?.tenant_id !== tenantId || document.scope?.branch_id !== branchId) throw new Error('Backup belongs to a different tenant or branch. Restore was blocked.');
  if (document.coverage !== 'local-device-cache-and-pending-operations-only') throw new Error('Backup coverage marker is invalid.');
  const { checksum_sha256: supplied, ...unsigned } = document;
  const actual = await sha256(JSON.stringify(unsigned));
  if (!supplied || actual !== supplied) throw new Error('Backup checksum does not match. File may be damaged or modified.');
  const writes = [];
  for (const name of TABLES) {
    const rows = document.tables?.[name];
    if (!Array.isArray(rows)) throw new Error(`Backup table ${name} is missing or invalid.`);
    for (const row of rows) {
      if (!(name === 'sync_meta' ? row.tenant_id === tenantId && row.branch_id === branchId : belongsToScope(row, tenantId, branchId))) throw new Error(`Backup contains a row outside the selected tenant/branch (${name}).`);
    }
    writes.push([offlineDb.table(name), rows]);
  }
  // Restore is a merge, never a replacement: existing local rows may be newer.
  // Auto-increment keys are device-local and must not be copied between browsers.
  await offlineDb.transaction('rw', ...writes.map(([table]) => table), async () => {
    for (const [table, rows] of writes) {
      if (!rows.length) continue;
      if (table.name === 'sync_meta') {
        for (const row of rows) {
          if (!row?.key) throw new Error('Backup contains an invalid sync metadata key. Restore was rolled back.');
          const existing = await table.get(row.key);
          if (!existing) await table.add(row);
          // Keep existing acknowledgement/context metadata; never replace newer local state.
        }
      } else if (table.name === 'outbox') {
        for (const original of rows) {
          const { local_id: _deviceLocalId, ...portable } = original;
          const row = portable.status === 'syncing'
            ? { ...portable, status: 'pending', sync_owner: null, lease_until: null }
            : portable;
          const existing = await table.where('operation_id').equals(row.operation_id).first();
          if (existing) {
            if (JSON.stringify(existing.payload) !== JSON.stringify(row.payload)
                || existing.tenant_id !== row.tenant_id || existing.branch_id !== row.branch_id) {
              throw new Error('An operation ID already exists locally with different content. Restore was rolled back.');
            }
            continue;
          }
          await table.add(row);
        }
      } else if (table.name === 'conflicts') {
        for (const original of rows) {
          const { local_id: _deviceLocalId, ...row } = original;
          const existing = await table.where('conflict_id').equals(row.conflict_id).first();
          if (existing) {
            if (existing.operation_id !== row.operation_id
                || existing.tenant_id !== row.tenant_id || existing.branch_id !== row.branch_id
                || JSON.stringify(existing.local_payload) !== JSON.stringify(row.local_payload)) {
              throw new Error('A conflict ID already exists locally with different content. Restore was rolled back.');
            }
            continue;
          }
          await table.add(row);
        }
      } else {
        for (const row of rows) {
          const existing = await table.get(row.id);
          if (existing) {
            if (existing.tenant_id !== row.tenant_id || (existing.branch_id ?? null) !== (row.branch_id ?? null)) {
              throw new Error(`A local record key belongs to another scope (${table.name}). Restore was rolled back.`);
            }
            // Keep the already-present row; it may contain newer local work.
            continue;
          }
          await table.add(row);
        }
      }
    }
  });
  return { restoredTables: writes.length, restoredRows: writes.reduce((sum, [, rows]) => sum + rows.length, 0) };
}
