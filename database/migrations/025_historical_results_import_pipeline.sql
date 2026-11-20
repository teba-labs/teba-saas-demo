-- Historical Excel results remain separate from operational visits, billing and the daily ledger.
-- Reuse public.historical_results; add provenance and idempotency instead of creating a duplicate result store.
alter table public.historical_results
  add column if not exists import_batch_id uuid,
  add column if not exists source_file_name text,
  add column if not exists source_file_sha256 text,
  add column if not exists source_sheet_name text,
  add column if not exists source_row_number integer,
  add column if not exists source_record_key text,
  add column if not exists result_at timestamptz,
  add column if not exists patient_age_raw text,
  add column if not exists patient_age_unit text,
  add column if not exists original_row jsonb not null default '{}'::jsonb;

create table if not exists public.historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  source_file_name text not null,
  source_file_sha256 text not null,
  storage_path text not null,
  mapping_snapshot jsonb not null default '{}'::jsonb,
  sheet_summary jsonb not null default '[]'::jsonb,
  status text not null default 'processing' check (status in ('processing','completed','partial','failed')),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_inserted integer not null default 0 check (rows_inserted >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint historical_import_batches_tenant_branch_fk
    foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  constraint historical_import_batches_file_unique unique (tenant_id, branch_id, source_file_sha256)
);

alter table public.historical_results
  add constraint historical_results_import_batch_fk
  foreign key (import_batch_id) references public.historical_import_batches(id) on delete restrict;

create unique index if not exists historical_results_source_record_unique
  on public.historical_results(tenant_id, branch_id, source_record_key)
  where source_record_key is not null;
create index if not exists historical_results_import_batch_idx
  on public.historical_results(tenant_id, branch_id, import_batch_id);
create index if not exists historical_results_name_date_idx
  on public.historical_results(tenant_id, branch_id, lower(patient_name_snapshot), result_date desc);

alter table public.historical_import_batches enable row level security;
drop policy if exists tsl_historical_import_batches_owner_all on public.historical_import_batches;
create policy tsl_historical_import_batches_owner_all
  on public.historical_import_batches for all to authenticated
  using (private.is_tenant_owner(tenant_id))
  with check (private.is_tenant_owner(tenant_id));

-- Historical results may be viewed by an authorized member of the branch.
-- Importing, editing or removing historical records is owner-only.
drop policy if exists tsl_historical_results_branch_access on public.historical_results;
drop policy if exists tsl_historical_results_read_branch on public.historical_results;
drop policy if exists tsl_historical_results_insert_owner on public.historical_results;
drop policy if exists tsl_historical_results_update_owner on public.historical_results;
drop policy if exists tsl_historical_results_delete_owner on public.historical_results;
create policy tsl_historical_results_read_branch
  on public.historical_results for select to authenticated
  using (private.can_access_branch(tenant_id, branch_id));
create policy tsl_historical_results_insert_owner
  on public.historical_results for insert to authenticated
  with check (private.is_tenant_owner(tenant_id) and private.can_access_branch(tenant_id, branch_id));
create policy tsl_historical_results_update_owner
  on public.historical_results for update to authenticated
  using (private.is_tenant_owner(tenant_id) and private.can_access_branch(tenant_id, branch_id))
  with check (private.is_tenant_owner(tenant_id) and private.can_access_branch(tenant_id, branch_id));
create policy tsl_historical_results_delete_owner
  on public.historical_results for delete to authenticated
  using (private.is_tenant_owner(tenant_id) and private.can_access_branch(tenant_id, branch_id));

grant select, insert, update, delete on public.historical_import_batches to authenticated;
grant select, insert, update, delete on public.historical_results to authenticated;

drop trigger if exists historical_import_batches_audit on public.historical_import_batches;
create trigger historical_import_batches_audit
  after insert or update or delete on public.historical_import_batches
  for each row execute function private.capture_audit_log();
