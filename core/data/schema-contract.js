/** Names from database schema v1.0. Kept centralized to prevent legacy table drift. */
export const TABLES = Object.freeze({
  tenants: 'tenants', tenantMemberships: 'tenant_memberships', branches: 'branches',
  branchMemberships: 'branch_memberships', staffDirectory: 'staff_directory',
  workdays: 'branch_workdays', patients: 'patients', visits: 'visits',
  catalog: 'tests_catalog', prices: 'test_prices', parameters: 'test_parameters',\n  masterCatalogReleases: 'master_catalog_releases', masterCatalogTests: 'master_catalog_tests',\n  masterCatalogParameters: 'master_catalog_parameters', tenantCatalogMasterLinks: 'tenant_catalog_master_links',
  visitTests: 'visit_tests', results: 'test_results', reportVersions: 'report_versions',
  billing: 'visit_billing', payments: 'payments', expenses: 'expenses',
  expenseCategories: 'expense_categories', ledger: 'financial_ledger',
  labSettings: 'lab_settings', printSettings: 'print_settings', auditLogs: 'audit_logs',
  syncOperations: 'sync_operations', syncConflicts: 'sync_conflicts',
});

export const RPC = Object.freeze({
  openBranchWorkday: 'open_branch_workday',
  closeBranchWorkday: 'close_branch_workday',
  recordPatientPayment: 'record_patient_payment',
  recordBranchExpense: 'record_branch_expense',
  platformCreateTenant: 'platform_create_tenant',
  createVisitIntakeIdempotent: 'create_visit_intake_idempotent',
  setCurrentTestPrice: 'set_current_test_price',
  setBranchTestPrice: 'set_branch_test_price',
});
