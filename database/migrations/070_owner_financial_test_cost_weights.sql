-- Add weighted cost-allocation input for generic historical test profitability.
begin;
alter table public.owner_financial_import_rows
  add column if not exists weight numeric(16,4);
create index if not exists owner_financial_import_rows_test_item_idx
  on public.owner_financial_import_rows(tenant_id,item_name,period_date);
commit;
