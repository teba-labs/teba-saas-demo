create table if not exists public.historical_import_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  sheet_name text not null,
  header_signature text not null,
  headers_json jsonb not null default '[]'::jsonb,
  entity_type text not null default 'historical_results',
  column_mapping jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint historical_import_templates_branch_fk foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete cascade,
  constraint historical_import_templates_scope_unique unique (tenant_id,branch_id,sheet_name,header_signature)
);
alter table public.historical_import_templates enable row level security;
drop policy if exists tsl_historical_import_templates_owner_all on public.historical_import_templates;
create policy tsl_historical_import_templates_owner_all on public.historical_import_templates for all to authenticated
using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
grant select,insert,update,delete on public.historical_import_templates to authenticated;
drop trigger if exists historical_import_templates_touch_updated_at on public.historical_import_templates;
create trigger historical_import_templates_touch_updated_at before update on public.historical_import_templates
for each row execute function private.touch_updated_at();
drop trigger if exists historical_import_templates_audit on public.historical_import_templates;
create trigger historical_import_templates_audit after insert or update or delete on public.historical_import_templates
for each row execute function private.capture_audit_log();
