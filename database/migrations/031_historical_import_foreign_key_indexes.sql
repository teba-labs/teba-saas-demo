create index if not exists historical_import_batches_created_by_idx on public.historical_import_batches(created_by);
create index if not exists historical_import_templates_updated_by_idx on public.historical_import_templates(updated_by);
create index if not exists historical_results_created_by_idx on public.historical_results(created_by);
