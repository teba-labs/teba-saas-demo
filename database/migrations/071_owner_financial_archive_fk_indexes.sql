-- Cover tenant-scoped foreign keys for the generic owner financial archive.
begin;
create index if not exists owner_financial_import_batches_created_by_idx
  on public.owner_financial_import_batches(created_by);
create index if not exists owner_financial_import_rows_batch_scope_fk_idx
  on public.owner_financial_import_rows(batch_id,tenant_id);
create index if not exists owner_financial_import_rows_branch_scope_fk_idx
  on public.owner_financial_import_rows(tenant_id,branch_id);
create index if not exists owner_dashboard_source_settings_updated_by_idx
  on public.owner_dashboard_source_settings(updated_by);
create index if not exists owner_dashboard_month_approvals_approved_by_idx
  on public.owner_dashboard_month_approvals(approved_by);
create index if not exists owner_dashboard_month_approvals_branch_scope_fk_idx
  on public.owner_dashboard_month_approvals(tenant_id,branch_id);
drop index if exists public.owner_financial_import_rows_test_item_idx;
drop index if exists public.owner_financial_import_rows_fingerprint_idx;
commit;
