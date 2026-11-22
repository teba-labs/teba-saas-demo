begin;

create table if not exists public.owner_historical_workbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  workbook_type text not null check (workbook_type in ('sales','prices','detail2025','detail2026')),
  file_name text not null,
  file_sha256 text not null,
  storage_path text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  sheet_summary jsonb not null default '[]'::jsonb,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  constraint owner_historical_workbooks_type_unique unique (tenant_id,workbook_type),
  constraint owner_historical_workbooks_path_unique unique (tenant_id,storage_path)
);

alter table public.owner_historical_workbooks enable row level security;
alter table public.owner_historical_workbooks force row level security;

drop policy if exists owner_historical_workbooks_owner_all on public.owner_historical_workbooks;
create policy owner_historical_workbooks_owner_all
  on public.owner_historical_workbooks
  for all to authenticated
  using (private.is_tenant_owner(tenant_id))
  with check (private.is_tenant_owner(tenant_id));

grant select,insert,update,delete on public.owner_historical_workbooks to authenticated;

drop trigger if exists owner_historical_workbooks_audit on public.owner_historical_workbooks;
create trigger owner_historical_workbooks_audit
  after insert or update or delete on public.owner_historical_workbooks
  for each row execute function private.capture_audit_log();

commit;
