drop index if exists public.historical_results_source_record_unique;
create unique index historical_results_source_record_unique
  on public.historical_results(tenant_id, branch_id, source_record_key);
