alter table public.historical_import_batches add column if not exists source_sheet_name text not null default '';
alter table public.historical_import_batches drop constraint if exists historical_import_batches_file_unique;
alter table public.historical_import_batches add constraint historical_import_batches_file_sheet_unique unique (tenant_id, branch_id, source_file_sha256, source_sheet_name);
