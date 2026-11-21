-- Generic owner financial archive: independent from live operations and from fixed workbook/year names.
begin;

create table if not exists public.owner_financial_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_name text not null,
  file_sha256 text not null,
  source_label text,
  period_start date,
  period_end date,
  mapping_snapshot jsonb not null default '{}'::jsonb,
  sheet_summary jsonb not null default '[]'::jsonb,
  status text not null default 'completed' check (status in ('preview','completed','partial','failed')),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint owner_financial_import_batch_file_unique unique (tenant_id,file_sha256),
  constraint owner_financial_import_batches_tenant_id_unique unique (tenant_id,id)
);

create table if not exists public.owner_financial_import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null references public.owner_financial_import_batches(id) on delete restrict,
  branch_id uuid,
  sheet_name text not null,
  row_number integer not null,
  period_date date,
  metric_key text not null,
  amount numeric(16,2),
  quantity numeric(16,3),
  item_name text,
  category_name text,
  unit_cost numeric(16,4),
  selling_price numeric(16,4),
  currency_code text,
  original_row jsonb not null default '{}'::jsonb,
  row_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint owner_financial_import_rows_branch_fk foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id) on delete restrict,
  constraint owner_financial_import_rows_batch_scope_fk foreign key (batch_id,tenant_id)
    references public.owner_financial_import_batches(id,tenant_id) on delete restrict,
  constraint owner_financial_import_rows_source_unique unique (batch_id,sheet_name,row_number,metric_key)
);

create index if not exists owner_financial_import_rows_scope_period_idx
  on public.owner_financial_import_rows(tenant_id,period_date,metric_key,branch_id);
create index if not exists owner_financial_import_rows_fingerprint_idx
  on public.owner_financial_import_rows(tenant_id,row_fingerprint);

create table if not exists public.owner_dashboard_source_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric_key text not null,
  source text not null check (source in ('live','excel')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,metric_key)
);

create table if not exists public.owner_dashboard_month_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_month date not null,
  branch_id uuid,
  source_choices jsonb not null default '{}'::jsonb,
  reconciliation_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  constraint owner_dashboard_month_approvals_branch_fk foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id) on delete restrict,
  constraint owner_dashboard_month_approvals_unique unique (tenant_id,period_month,branch_id)
);

alter table public.owner_financial_import_batches enable row level security;
alter table public.owner_financial_import_batches force row level security;
alter table public.owner_financial_import_rows enable row level security;
alter table public.owner_financial_import_rows force row level security;
alter table public.owner_dashboard_source_settings enable row level security;
alter table public.owner_dashboard_source_settings force row level security;
alter table public.owner_dashboard_month_approvals enable row level security;
alter table public.owner_dashboard_month_approvals force row level security;

drop policy if exists owner_financial_batches_owner_all on public.owner_financial_import_batches;
create policy owner_financial_batches_owner_all on public.owner_financial_import_batches
 for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

drop policy if exists owner_financial_rows_owner_all on public.owner_financial_import_rows;
create policy owner_financial_rows_owner_all on public.owner_financial_import_rows
 for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

drop policy if exists owner_dashboard_sources_owner_all on public.owner_dashboard_source_settings;
create policy owner_dashboard_sources_owner_all on public.owner_dashboard_source_settings
 for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

drop policy if exists owner_dashboard_approvals_owner_all on public.owner_dashboard_month_approvals;
create policy owner_dashboard_approvals_owner_all on public.owner_dashboard_month_approvals
 for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

grant select,insert,update,delete on public.owner_financial_import_batches,
 public.owner_financial_import_rows,public.owner_dashboard_source_settings,
 public.owner_dashboard_month_approvals to authenticated;

drop trigger if exists owner_financial_import_batches_audit on public.owner_financial_import_batches;
create trigger owner_financial_import_batches_audit after insert or update or delete
 on public.owner_financial_import_batches for each row execute function private.capture_audit_log();
drop trigger if exists owner_dashboard_source_settings_audit on public.owner_dashboard_source_settings;
create trigger owner_dashboard_source_settings_audit after insert or update or delete
 on public.owner_dashboard_source_settings for each row execute function private.capture_audit_log();
drop trigger if exists owner_dashboard_month_approvals_audit on public.owner_dashboard_month_approvals;
create trigger owner_dashboard_month_approvals_audit after insert or update or delete
 on public.owner_dashboard_month_approvals for each row execute function private.capture_audit_log();

commit;
