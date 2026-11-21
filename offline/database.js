import Dexie from 'https://esm.sh/dexie@4';

/** New DB name avoids mutating or colliding with the legacy TebaLabOfflineDB. */
export const offlineDb = new Dexie('TaibaSmartLabOfflineDB');
const stores = {
  patients: 'id, tenant_id, branch_id, updated_at',
  visits: 'id, tenant_id, branch_id, patient_id, workday_id, visit_number, updated_at',
  visit_tests: 'id, tenant_id, branch_id, visit_id, status, updated_at',
  test_results: 'id, tenant_id, branch_id, visit_test_id, updated_at',
  catalog: 'id, tenant_id, code, is_active, updated_at',
  test_prices: 'id, tenant_id, test_id, is_current, effective_from',
  test_parameters: 'id, tenant_id, test_id, parameter_code, is_active',
  staff_directory: 'id, tenant_id, branch_id, is_active',
  workdays: 'id, tenant_id, branch_id, work_date, status',
  expense_categories: 'id, tenant_id, is_active',
  financial_ledger: 'id, tenant_id, branch_id, work_date, movement_at',
  daily_closings: 'id, tenant_id, branch_id, work_date',
  culture_isolates: 'id, tenant_id, branch_id, visit_test_id, isolate_number',
  culture_susceptibilities: 'id, tenant_id, branch_id, isolate_id, antimicrobial_agent',
  outbox: '++local_id, &operation_id, [tenant_id+branch_id], status, created_at, next_attempt_at, entity_type',
  sync_meta: '&key',
  conflicts: '++local_id, &conflict_id, tenant_id, branch_id, created_at, status',
};
offlineDb.version(1).stores({ ...stores });
offlineDb.version(2).stores({ ...stores });
offlineDb.version(3).stores({
  ...stores,
  test_prices: 'id, tenant_id, test_id, branch_id, is_current, effective_from',
});
offlineDb.version(4).stores({ ...stores });

export async function assertOfflineDatabaseReady() {
  await offlineDb.open();
  return offlineDb.tables.map(table => table.name);
}
