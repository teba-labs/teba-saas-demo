/*
===============================================================================
TAIBA SMART LAB — INITIAL DATABASE BUILD
Target: a CLEAN Supabase project (the test project only)
Version: 1.0.0
Date: 2026-11-17

IMPORTANT
- This script is designed for a clean public schema and is non-destructive:
  it does not DROP tables, data, users, buckets, or existing project settings.
- Run the whole script once in Supabase SQL Editor.
- It creates database structures and security policies; it does NOT create
  Auth users, configure SMTP, deploy Edge Functions, or edit frontend files.
- Do not run this against the production project.
- First platform administrator bootstrap is a separate, explicit step listed
  in README_AR.md; no user is silently granted platform-owner access.
===============================================================================
*/

begin;

-- 0) SCHEMAS AND BASE PERMISSIONS
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;

-- The UUID generator is built into supported Supabase PostgreSQL versions.

-- 1) CORE TENANT / AUTH / BRANCH STRUCTURE
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  status text not null default 'trial' check (status in ('trial','active','suspended','expired','closed')),
  timezone text not null default 'Africa/Cairo',
  currency_code char(3) not null default 'EGP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  account_type text not null check (account_type in ('owner','employee')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists idx_tenant_memberships_user on public.tenant_memberships(user_id, is_active);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  address text,
  phone text,
  map_link text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create index if not exists idx_branches_tenant on public.branches(tenant_id, is_active);

-- A branch workday is opened and closed manually; after midnight, visits remain
-- attached to the still-open workday rather than following the calendar date.
create table if not exists public.branch_workdays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  work_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  opened_by uuid references auth.users(id) on delete set null,
  opened_by_staff_id uuid,
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_staff_id uuid,
  closed_at timestamptz,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id,id) on delete restrict,
  unique (tenant_id, branch_id, work_date),
  unique (tenant_id, branch_id, id)
);
create unique index if not exists uq_branch_one_open_workday on public.branch_workdays(tenant_id,branch_id) where status='open';


create table if not exists public.branch_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict
);
create index if not exists idx_branch_memberships_branch on public.branch_memberships(tenant_id, branch_id, is_active);

create table if not exists public.staff_directory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  display_name text not null check (length(trim(display_name)) between 2 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  unique (tenant_id, branch_id, display_name),
  unique (tenant_id, branch_id, id),
  unique (tenant_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_branch_workdays_opened_staff' AND conrelid='public.branch_workdays'::regclass) THEN
    ALTER TABLE public.branch_workdays ADD CONSTRAINT fk_branch_workdays_opened_staff
      FOREIGN KEY (tenant_id,branch_id,opened_by_staff_id) REFERENCES public.staff_directory(tenant_id,branch_id,id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_branch_workdays_closed_staff' AND conrelid='public.branch_workdays'::regclass) THEN
    ALTER TABLE public.branch_workdays ADD CONSTRAINT fk_branch_workdays_closed_staff
      FOREIGN KEY (tenant_id,branch_id,closed_by_staff_id) REFERENCES public.staff_directory(tenant_id,branch_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 2) TENANT AND BRANCH AUTHORIZATION HELPERS
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  note text
);

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

create or replace function private.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.is_active
  );
$$;

create or replace function private.is_tenant_owner(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
      and tm.account_type = 'owner' and tm.is_active
  );
$$;

create or replace function private.can_access_branch(p_tenant_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select private.is_tenant_owner(p_tenant_id)
    or exists (
      select 1 from public.branch_memberships bm
      join public.tenant_memberships tm
        on tm.tenant_id = bm.tenant_id and tm.user_id = bm.user_id
      where bm.tenant_id = p_tenant_id and bm.branch_id = p_branch_id
        and bm.user_id = auth.uid() and bm.is_active and tm.is_active
        and tm.account_type = 'employee'
    );
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = pg_catalog
as $$ begin new.updated_at := now(); return new; end; $$;

-- 3) PATIENTS / VISITS / TEST CATALOG / RESULTS
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  patient_number text,
  full_name text not null,
  phone text,
  age_years numeric(5,2),
  sex text check (sex is null or sex in ('male','female','other','unknown')),
  created_by uuid references auth.users(id) on delete set null,
  created_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, created_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, branch_id, patient_number),
  unique (tenant_id, branch_id, id)
);
create index if not exists idx_patients_branch_name on public.patients(tenant_id, branch_id, full_name);
create index if not exists idx_patients_phone on public.patients(tenant_id, branch_id, phone);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  patient_id uuid not null,
  workday_id uuid not null,
  visit_number text not null,
  visit_work_date date not null default current_date,
  status text not null default 'open' check (status in ('open','in_progress','ready_for_review','approved','published','cancelled')),
  is_published boolean not null default false,
  published_at timestamptz,
  referred_by text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_staff_id uuid,
  approved_by uuid references auth.users(id) on delete set null,
  approved_by_staff_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, patient_id) references public.patients(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, workday_id) references public.branch_workdays(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, created_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, approved_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, branch_id, visit_number),
  unique (tenant_id, branch_id, id)
);
create index if not exists idx_visits_branch_date on public.visits(tenant_id, branch_id, visit_work_date desc);
create index if not exists idx_visits_patient on public.visits(tenant_id, branch_id, patient_id, created_at desc);

create table if not exists public.tests_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  name text not null,
  category text,
  specimen text,
  method text,
  turnaround_minutes integer,
  instructions text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create index if not exists idx_tests_catalog_tenant_active on public.tests_catalog(tenant_id, is_active, name);

-- Price is intentionally separate: employee accounts cannot change it.
create table if not exists public.test_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  test_id uuid not null,
  selling_price numeric(12,2) not null check (selling_price >= 0),
  effective_from timestamptz not null default now(),
  is_current boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, test_id) references public.tests_catalog(tenant_id, id) on delete restrict
);
create unique index if not exists uq_test_prices_current on public.test_prices(tenant_id, test_id) where is_current;

create table if not exists public.test_parameters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  test_id uuid not null,
  parameter_code text not null,
  parameter_name text not null,
  unit text,
  value_type text not null default 'numeric' check (value_type in ('numeric','text','boolean','choice')),
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  reference_ranges jsonb not null default '[]'::jsonb,
  choices jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  is_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, test_id) references public.tests_catalog(tenant_id, id) on delete restrict,
  unique (tenant_id, test_id, parameter_code)
);

create table if not exists public.visit_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_id uuid not null,
  test_id uuid not null,
  test_code_snapshot text not null,
  test_name_snapshot text not null,
  price_snapshot numeric(12,2) not null default 0 check (price_snapshot >= 0),
  technical_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_staff_id uuid,
  foreign key (tenant_id, branch_id, created_by_staff_id) references public.staff_directory(tenant_id,branch_id,id) on delete restrict,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, test_id) references public.tests_catalog(tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
create index if not exists idx_visit_tests_visit on public.visit_tests(tenant_id, visit_id);

-- Visit authorization helpers are declared only after their referenced tables exist.
create or replace function private.can_access_visit(p_visit_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.visits v
    where v.id = p_visit_id and private.can_access_branch(v.tenant_id, v.branch_id)
  );
$$;

create or replace function private.can_access_visit_test(p_visit_test_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.visit_tests vt
    join public.visits v on v.id = vt.visit_id
    where vt.id = p_visit_test_id
      and private.can_access_branch(v.tenant_id, v.branch_id)
  );
$$;


create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  visit_test_id uuid not null,
  parameter_code text not null,
  parameter_name_snapshot text not null,
  value_numeric numeric,
  value_text text,
  unit_snapshot text,
  reference_range_snapshot jsonb not null default '{}'::jsonb,
  flag text check (flag is null or flag in ('low','normal','high','critical','abnormal')),
  correction_reason text,
  entered_by uuid references auth.users(id) on delete set null,
  entered_by_staff_id uuid,
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (visit_test_id, parameter_code),
  foreign key (tenant_id, visit_test_id) references public.visit_tests(tenant_id, id) on delete restrict,
  foreign key (tenant_id, entered_by_staff_id) references public.staff_directory(tenant_id, id) on delete restrict,
  check (value_numeric is not null or value_text is not null)
);
create index if not exists idx_test_results_visit_test on public.test_results(visit_test_id);

create table if not exists public.historical_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  patient_id uuid,
  patient_name_snapshot text not null,
  test_code text not null,
  test_name_snapshot text not null,
  result_date date not null,
  result_data jsonb not null,
  source text not null default 'manual' check (source in ('manual','import','legacy_migration')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, patient_id) references public.patients(tenant_id, branch_id, id) on delete restrict
);
create index if not exists idx_historical_results_patient_date on public.historical_results(tenant_id, branch_id, patient_id, result_date desc);

create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_id uuid not null references public.visits(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  storage_path text not null,
  report_snapshot jsonb not null,
  change_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  is_published boolean not null default false,
  published_at timestamptz,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict,
  unique (visit_id, version_number)
);
create index if not exists idx_report_versions_visit on public.report_versions(tenant_id, visit_id, version_number desc);

-- 4) BILLING / PAYMENTS / EXPENSES / LEDGER / CLOSINGS
create table if not exists public.visit_billing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_id uuid not null unique references public.visits(id) on delete restrict,
  gross_total numeric(14,2) not null check (gross_total >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  net_total numeric(14,2) generated always as (gross_total - discount_amount) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (discount_amount <= gross_total),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_id uuid not null references public.visits(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','wallet','bank_transfer','other')),
  idempotency_key uuid not null,
  received_by uuid references auth.users(id) on delete set null,
  received_by_staff_id uuid,
  received_at timestamptz not null default now(),
  notes text,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, received_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, idempotency_key)
);
create index if not exists idx_payments_visit on public.payments(tenant_id, visit_id, received_at);

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  category_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,
  idempotency_key uuid not null,
  spent_by uuid references auth.users(id) on delete set null,
  spent_by_staff_id uuid,
  spent_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, category_id) references public.expense_categories(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, spent_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, idempotency_key)
);

create table if not exists public.financial_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  source_type text not null check (source_type in ('payment','expense','refund','adjustment')),
  source_id uuid not null,
  direction text not null check (direction in ('inflow','outflow')),
  amount numeric(14,2) not null check (amount > 0),
  movement_at timestamptz not null default now(),
  work_date date not null default current_date,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  unique (tenant_id, source_type, source_id)
);
create index if not exists idx_ledger_tenant_date on public.financial_ledger(tenant_id, work_date, branch_id);

create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  workday_id uuid not null,
  work_date date not null,
  closing_snapshot jsonb not null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_staff_id uuid,
  closed_at timestamptz not null default now(),
  status text not null default 'closed' check (status in ('closed','reopened','adjusted')),
  reopen_reason text,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, workday_id) references public.branch_workdays(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, closed_by_staff_id) references public.staff_directory(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, branch_id, work_date)
);

create table if not exists public.monthly_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  month_start date not null,
  system_snapshot jsonb not null,
  excel_file_path text,
  excel_snapshot jsonb,
  line_decisions jsonb not null default '[]'::jsonb,
  final_snapshot jsonb,
  status text not null default 'draft' check (status in ('draft','under_review','approved','reopened')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, month_start)
);

-- Ledger rows are generated by source transactions, not edited directly.
create or replace function private.add_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_timezone text;
begin
  select timezone into v_timezone from public.tenants where id=new.tenant_id;
  insert into public.financial_ledger(tenant_id, branch_id, source_type, source_id, direction, amount, movement_at, work_date, description, created_by)
  values (new.tenant_id, new.branch_id, 'payment', new.id, 'inflow', new.amount, new.received_at, (new.received_at at time zone coalesce(v_timezone,'Africa/Cairo'))::date, 'Patient payment', new.received_by)
  on conflict (tenant_id, source_type, source_id) do nothing;
  return new;
end;
$$;
create or replace function private.add_expense_to_ledger()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_timezone text;
begin
  select timezone into v_timezone from public.tenants where id=new.tenant_id;
  insert into public.financial_ledger(tenant_id, branch_id, source_type, source_id, direction, amount, movement_at, work_date, description, created_by)
  values (new.tenant_id, new.branch_id, 'expense', new.id, 'outflow', new.amount, new.spent_at, (new.spent_at at time zone coalesce(v_timezone,'Africa/Cairo'))::date, coalesce(new.description,'Expense'), new.spent_by)
  on conflict (tenant_id, source_type, source_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_payment_ledger on public.payments;
create trigger trg_payment_ledger after insert on public.payments for each row execute function private.add_payment_to_ledger();
drop trigger if exists trg_expense_ledger on public.expenses;
create trigger trg_expense_ledger after insert on public.expenses for each row execute function private.add_expense_to_ledger();

-- Secure payment and expense RPCs; client cannot write to ledger directly.
create or replace function public.record_patient_payment(
  p_tenant_id uuid, p_visit_id uuid, p_amount numeric,
  p_payment_method text, p_idempotency_key uuid, p_staff_id uuid, p_notes text default null
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_branch_id uuid; v_net numeric; v_paid numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select v.branch_id into v_branch_id from public.visits v
    where v.id = p_visit_id and v.tenant_id = p_tenant_id;
  if v_branch_id is null or not private.can_access_branch(p_tenant_id, v_branch_id) then
    raise exception 'Visit not accessible';
  end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=v_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid payment amount'; end if;
  select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_id is not null then
    if not exists (select 1 from public.payments where id=v_id and visit_id=p_visit_id and amount=p_amount) then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_id;
  end if;
  select vb.net_total into v_net from public.visit_billing vb where vb.visit_id = p_visit_id and vb.tenant_id = p_tenant_id for update;
  if v_net is null then raise exception 'Visit billing not found'; end if;
  -- Recheck after locking the invoice so concurrent retries with the same key are idempotent.
  select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_id is not null then
    if not exists (select 1 from public.payments where id=v_id and visit_id=p_visit_id and amount=p_amount) then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_id;
  end if;
  select coalesce(sum(py.amount),0) into v_paid from public.payments py where py.visit_id = p_visit_id;
  if v_paid + p_amount > v_net then raise exception 'Payment exceeds remaining balance'; end if;
  insert into public.payments(tenant_id, branch_id, visit_id, amount, payment_method, idempotency_key, received_by, received_by_staff_id, notes)
  values (p_tenant_id, v_branch_id, p_visit_id, p_amount, coalesce(p_payment_method,'cash'), p_idempotency_key, auth.uid(), p_staff_id, p_notes)
  on conflict (tenant_id, idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.record_branch_expense(
  p_tenant_id uuid, p_branch_id uuid, p_category_id uuid,
  p_amount numeric, p_description text, p_idempotency_key uuid, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch not accessible';
  end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid expense amount'; end if;
  if not exists (select 1 from public.expense_categories ec where ec.id=p_category_id and ec.tenant_id=p_tenant_id and ec.is_active) then
    raise exception 'Expense category unavailable';
  end if;
  insert into public.expenses(tenant_id,branch_id,category_id,amount,description,idempotency_key,spent_by,spent_by_staff_id)
  values (p_tenant_id,p_branch_id,p_category_id,p_amount,p_description,p_idempotency_key,auth.uid(),p_staff_id)
  on conflict (tenant_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.expenses where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
    if not exists (select 1 from public.expenses where id=v_id and branch_id=p_branch_id and category_id=p_category_id and amount=p_amount) then
      raise exception 'Idempotency key reused with different expense data';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function private.assign_open_workday_to_visit()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_workday public.branch_workdays%rowtype;
begin
  select * into v_workday from public.branch_workdays bw
  where bw.tenant_id=new.tenant_id and bw.branch_id=new.branch_id and bw.status='open'
  order by bw.opened_at desc limit 1;
  if v_workday.id is null then raise exception 'Open the branch workday before registering visits'; end if;
  new.workday_id := v_workday.id;
  new.visit_work_date := v_workday.work_date;
  return new;
end;
$$;
drop trigger if exists trg_assign_open_workday_to_visit on public.visits;
create trigger trg_assign_open_workday_to_visit before insert on public.visits
for each row execute function private.assign_open_workday_to_visit();

create or replace function public.open_branch_workday(
  p_tenant_id uuid, p_branch_id uuid, p_work_date date, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_id uuid; v_status text;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch not accessible';
  end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if exists (select 1 from public.branch_workdays where tenant_id=p_tenant_id and branch_id=p_branch_id and status='open' and work_date<>p_work_date) then
    raise exception 'Close the currently open workday before opening another date';
  end if;
  select id,status into v_id,v_status from public.branch_workdays
    where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date;
  if v_id is not null then
    if v_status='closed' then raise exception 'This workday is already closed'; end if;
    return v_id;
  end if;
  insert into public.branch_workdays(tenant_id,branch_id,work_date,opened_by,opened_by_staff_id)
  values(p_tenant_id,p_branch_id,p_work_date,auth.uid(),p_staff_id)
  on conflict (tenant_id,branch_id,work_date) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.branch_workdays where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date; end if;
  return v_id;
end;
$$;

create or replace function public.close_branch_workday(
  p_tenant_id uuid, p_branch_id uuid, p_work_date date, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_id uuid; v_workday_id uuid; v_snapshot jsonb; v_inflow numeric(14,2); v_outflow numeric(14,2); v_cases bigint; v_tests bigint; v_receivables numeric(14,2);
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch not accessible';
  end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  select id into v_id from public.daily_closings where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date;
  if v_id is not null then return v_id; end if;
  select id into v_workday_id from public.branch_workdays where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date and status='open' for update;
  if v_workday_id is null then raise exception 'No open workday found for this date'; end if;
  select coalesce(sum(amount) filter (where direction='inflow'),0),
         coalesce(sum(amount) filter (where direction='outflow'),0)
    into v_inflow,v_outflow from public.financial_ledger
    where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date;
  select count(*) into v_cases from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_work_date=p_work_date and status <> 'cancelled';
  select count(*) into v_tests from public.visit_tests vt join public.visits v on v.id=vt.visit_id
    where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.visit_work_date=p_work_date and vt.status <> 'cancelled';
  select coalesce(sum(greatest(vb.net_total-coalesce(px.paid,0),0)),0) into v_receivables
    from public.visit_billing vb join public.visits v on v.id=vb.visit_id
    left join (select visit_id,sum(amount) paid from public.payments group by visit_id) px on px.visit_id=vb.visit_id
    where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.visit_work_date=p_work_date;
  v_snapshot := jsonb_build_object('work_date',p_work_date,'collected',v_inflow,'expenses',v_outflow,
    'net_cash',v_inflow-v_outflow,'cases',v_cases,'tests',v_tests,'receivables',v_receivables);
  update public.branch_workdays set status='closed',closed_by=auth.uid(),closed_by_staff_id=p_staff_id,closed_at=now() where id=v_workday_id;
  insert into public.daily_closings(tenant_id,branch_id,workday_id,work_date,closing_snapshot,closed_by,closed_by_staff_id)
  values(p_tenant_id,p_branch_id,v_workday_id,p_work_date,v_snapshot,auth.uid(),p_staff_id)
  on conflict (tenant_id,branch_id,work_date) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.daily_closings where tenant_id=p_tenant_id and branch_id=p_branch_id and work_date=p_work_date; end if;
  return v_id;
end;
$$;

-- Price snapshots come from manager-controlled prices, never from the employee device.
create or replace function private.apply_catalog_price_snapshot()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_price numeric(12,2); v_code text; v_name text; v_params jsonb;
begin
  if tg_op='UPDATE' then
    if new.price_snapshot is distinct from old.price_snapshot
       or new.technical_snapshot is distinct from old.technical_snapshot
       or new.test_code_snapshot is distinct from old.test_code_snapshot
       or new.test_name_snapshot is distinct from old.test_name_snapshot then
      raise exception 'Visit test price and technical snapshots are immutable';
    end if;
    return new;
  end if;
  select tc.code,tc.name into v_code,v_name from public.tests_catalog tc
    where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
  if v_code is null then raise exception 'Test is not active in this tenant catalog'; end if;
  select tp.selling_price into v_price from public.test_prices tp
    where tp.tenant_id=new.tenant_id and tp.test_id=new.test_id and tp.is_current;
  if v_price is null then raise exception 'No active price configured for this test'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'code',p.parameter_code,'name',p.parameter_name,'unit',p.unit,
      'value_type',p.value_type,'decimal_places',p.decimal_places,
      'reference_ranges',p.reference_ranges,'choices',p.choices,
      'display_order',p.display_order,'is_required',p.is_required
    ) order by p.display_order,p.parameter_code),'[]'::jsonb)
    into v_params from public.test_parameters p
    where p.tenant_id=new.tenant_id and p.test_id=new.test_id and p.is_active;
  if jsonb_array_length(v_params)=0 then raise exception 'Define at least one active parameter before ordering this test'; end if;
  new.price_snapshot := v_price;
  new.test_code_snapshot := v_code;
  new.test_name_snapshot := v_name;
  new.technical_snapshot := jsonb_build_object('parameters',v_params);
  return new;
end;
$$;
drop trigger if exists trg_visit_test_price_snapshot on public.visit_tests;
create trigger trg_visit_test_price_snapshot before insert or update on public.visit_tests
for each row execute function private.apply_catalog_price_snapshot();

create or replace function private.validate_visit_billing()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_sum numeric(14,2);
begin
  select coalesce(sum(vt.price_snapshot),0) into v_sum from public.visit_tests vt
  where vt.tenant_id=new.tenant_id and vt.branch_id=new.branch_id and vt.visit_id=new.visit_id and vt.status <> 'cancelled';
  if new.gross_total <> v_sum then raise exception 'Gross total must equal visit test price snapshots'; end if;
  if new.discount_amount > new.gross_total then raise exception 'Discount exceeds gross total'; end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_visit_billing on public.visit_billing;
create trigger trg_validate_visit_billing before insert on public.visit_billing
for each row execute function private.validate_visit_billing();

create or replace function private.protect_last_tenant_owner()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_remaining integer;
begin
  if old.account_type='owner' and old.is_active and
     (tg_op='DELETE' or new.account_type <> 'owner' or not new.is_active) then
    select count(*) into v_remaining from public.tenant_memberships tm
      where tm.tenant_id=old.tenant_id and tm.account_type='owner' and tm.is_active and tm.id<>old.id;
    if v_remaining=0 then raise exception 'A tenant must retain at least one active owner'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists trg_protect_last_tenant_owner on public.tenant_memberships;
create trigger trg_protect_last_tenant_owner before update or delete on public.tenant_memberships
for each row execute function private.protect_last_tenant_owner();

create or replace function private.validate_branch_membership_role()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_role text;
begin
  select account_type into v_role from public.tenant_memberships
  where tenant_id=new.tenant_id and user_id=new.user_id and is_active;
  if v_role is distinct from 'employee' then raise exception 'Branch membership requires an active employee membership'; end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_branch_membership_role on public.branch_memberships;
create trigger trg_validate_branch_membership_role before insert or update on public.branch_memberships
for each row execute function private.validate_branch_membership_role();

create or replace function private.guard_visit_workday()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.branch_id is distinct from old.branch_id
     or new.patient_id is distinct from old.patient_id or new.workday_id is distinct from old.workday_id
     or new.visit_work_date is distinct from old.visit_work_date or new.visit_number is distinct from old.visit_number then
    raise exception 'Visit identity, branch, workday and visit number are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_visit_workday on public.visits;
create trigger trg_guard_visit_workday before update on public.visits
for each row execute function private.guard_visit_workday();

create or replace function private.guard_visit_test_snapshot()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.branch_id is distinct from old.branch_id
     or new.visit_id is distinct from old.visit_id
     or new.test_id is distinct from old.test_id
     or new.test_code_snapshot is distinct from old.test_code_snapshot
     or new.test_name_snapshot is distinct from old.test_name_snapshot
     or new.price_snapshot is distinct from old.price_snapshot
     or new.technical_snapshot is distinct from old.technical_snapshot then
    raise exception 'Visit test identity and snapshots are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_visit_test_snapshot on public.visit_tests;
create trigger trg_guard_visit_test_snapshot before update on public.visit_tests
for each row execute function private.guard_visit_test_snapshot();

create or replace function private.validate_result_parameter()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_snapshot jsonb; v_branch uuid; v_parameter jsonb;
begin
  select technical_snapshot,branch_id into v_snapshot,v_branch from public.visit_tests where id=new.visit_test_id and tenant_id=new.tenant_id;
  if new.entered_by_staff_id is not null and not exists (select 1 from public.staff_directory sd where sd.id=new.entered_by_staff_id and sd.tenant_id=new.tenant_id and sd.branch_id=v_branch and sd.is_active) then
    raise exception 'Selected staff name does not belong to this branch';
  end if;
  select p into v_parameter from jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
    where p->>'code'=new.parameter_code limit 1;
  if v_parameter is null then raise exception 'Result parameter is not part of the visit test snapshot'; end if;
  -- These report fields are copied from the frozen visit snapshot, not trusted from the browser.
  new.parameter_name_snapshot := v_parameter->>'name';
  new.unit_snapshot := v_parameter->>'unit';
  new.reference_range_snapshot := coalesce(v_parameter->'reference_ranges','[]'::jsonb);
  if coalesce(v_parameter->>'value_type','numeric')='numeric' and (new.value_numeric is null or new.value_text is not null) then
    raise exception 'A numeric parameter requires only a numeric result';
  end if;
  if coalesce(v_parameter->>'value_type','numeric') <> 'numeric' and (new.value_text is null or new.value_numeric is not null) then
    raise exception 'A text/choice parameter requires only a text result';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_result_parameter on public.test_results;
create trigger trg_validate_result_parameter before insert or update on public.test_results
for each row execute function private.validate_result_parameter();

-- Published clinical results cannot be silently overwritten; corrections need a reason.
create or replace function private.guard_published_result_correction()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_visit_id uuid; v_is_published boolean;
begin
  if tg_op='DELETE' then
    select vt.visit_id into v_visit_id from public.visit_tests vt where vt.id=old.visit_test_id;
  else
    select vt.visit_id into v_visit_id from public.visit_tests vt where vt.id=new.visit_test_id;
  end if;
  select v.is_published into v_is_published from public.visits v where v.id=v_visit_id;
  if coalesce(v_is_published,false) then
    if tg_op='DELETE' then raise exception 'Published results cannot be deleted'; end if;
    if tg_op='INSERT' then raise exception 'Use the documented correction workflow for published visits'; end if;
    if nullif(trim(new.correction_reason),'') is null then
      raise exception 'A published result correction requires a documented reason';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists trg_guard_published_result_correction on public.test_results;
create trigger trg_guard_published_result_correction before insert or update or delete on public.test_results
for each row execute function private.guard_published_result_correction();

create or replace function private.validate_report_version_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_count integer; v_incomplete integer; v_visit_status text;
begin
  if new.is_published then
    select status into v_visit_status from public.visits where id=new.visit_id;
    if v_visit_status <> 'approved' then raise exception 'Visit must be approved before report publication'; end if;
    select count(*) into v_count from public.visit_tests vt
      where vt.visit_id=new.visit_id and vt.status <> 'cancelled';
    select count(*) into v_incomplete from public.visit_tests vt
      where vt.visit_id=new.visit_id and vt.status <> 'cancelled'
        and (vt.status <> 'completed' or exists (
          select 1 from jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
          where coalesce((p->>'is_required')::boolean,true)
            and not exists (select 1 from public.test_results tr where tr.visit_test_id=vt.id and tr.parameter_code=p->>'code')
        ));
    if v_count=0 or v_incomplete>0 then
      raise exception 'Cannot publish: every required parameter of every requested test must have a result';
    end if;
    if nullif(trim(new.storage_path),'') is null then raise exception 'Published report storage path is required'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_report_version_publication on public.report_versions;
create trigger trg_validate_report_version_publication before insert on public.report_versions
for each row execute function private.validate_report_version_publication();

create or replace function private.guard_visit_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if new.status='published' and not new.is_published then raise exception 'Published status requires a published report'; end if;
  if new.is_published then
    if new.status <> 'published' then raise exception 'Published visit must have published status'; end if;
    if tg_op='INSERT' then raise exception 'Create the visit first, then approve and publish a report version'; end if;
    if old.status <> 'approved' and not old.is_published then
      raise exception 'Visit must be approved before publication';
    end if;
    if not exists (select 1 from public.report_versions rv where rv.visit_id=new.id and rv.is_published) then
      raise exception 'A published report version is required before publishing the visit';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_visit_publication on public.visits;
create trigger trg_guard_visit_publication before insert or update on public.visits
for each row execute function private.guard_visit_publication();

-- 5) SETTINGS / AUDIT / SYNC / BACKUPS
create table if not exists public.lab_settings (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  laboratory_name text,
  doctor_name text,
  logo_path text,
  phone text,
  whatsapp text,
  address text,
  report_footer text,
  whatsapp_template text,
  settings_json jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.print_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  settings_json jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  unique nulls not distinct (tenant_id, branch_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_staff_id uuid references public.staff_directory(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id) references public.tenants(id) on delete restrict,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict
);
create index if not exists idx_audit_tenant_time on public.audit_logs(tenant_id, occurred_at desc);

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  operation_id uuid not null,
  operation_type text not null,
  status text not null default 'received' check (status in ('received','applied','rejected','conflict')),
  response_payload jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  unique (tenant_id, operation_id)
);

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  operation_id uuid,
  entity_type text not null,
  entity_id text not null,
  local_payload jsonb not null,
  server_payload jsonb not null,
  resolution text check (resolution is null or resolution in ('accepted_local','kept_server','merged','manual')),
  resolution_payload jsonb,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict
);

create table if not exists public.file_metadata (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid,
  related_visit_id uuid,
  bucket_id text not null,
  storage_path text not null,
  file_kind text not null check (file_kind in ('report','attachment','site_asset','backup','import','other')),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, related_visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict
);
create index if not exists idx_file_metadata_tenant on public.file_metadata(tenant_id, file_kind, created_at desc);

-- Written only by the patient-portal Edge Function using server credentials.
-- Do not expose this table through anon/authenticated APIs.
create table if not exists public.portal_access_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  lookup_hash text not null,
  ip_hash text,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_portal_attempts_lookup_time on public.portal_access_attempts(tenant_id, lookup_hash, attempted_at desc);


create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  backup_type text not null check (backup_type in ('full','reports','financial','manual_export')),
  storage_path text,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'started' check (status in ('started','completed','failed','restored')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_at timestamptz,
  error_message text
);

create or replace function private.capture_audit_log()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare j_new jsonb; j_old jsonb; v_tenant uuid; v_branch uuid; v_id text; v_staff uuid;
begin
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  v_tenant := coalesce(nullif(j_new->>'tenant_id','')::uuid, nullif(j_old->>'tenant_id','')::uuid);
  v_branch := coalesce(nullif(j_new->>'branch_id','')::uuid, nullif(j_old->>'branch_id','')::uuid);
  v_id := coalesce(j_new->>'id', j_old->>'id');
  v_staff := coalesce(nullif(j_new->>'created_by_staff_id',''),nullif(j_new->>'approved_by_staff_id',''),nullif(j_new->>'entered_by_staff_id',''),nullif(j_new->>'received_by_staff_id',''),nullif(j_new->>'spent_by_staff_id',''),nullif(j_new->>'closed_by_staff_id',''),nullif(j_new->>'opened_by_staff_id',''),nullif(j_old->>'created_by_staff_id',''),nullif(j_old->>'approved_by_staff_id',''),nullif(j_old->>'entered_by_staff_id',''),nullif(j_old->>'received_by_staff_id',''),nullif(j_old->>'spent_by_staff_id',''),nullif(j_old->>'closed_by_staff_id',''),nullif(j_old->>'opened_by_staff_id',''))::uuid;
  if v_tenant is not null then
    insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_staff_id,action,table_name,record_id,old_data,new_data)
    values (v_tenant,v_branch,auth.uid(),v_staff,lower(tg_op),tg_table_name,v_id,
      case when tg_op='INSERT' then null else j_old end,
      case when tg_op='DELETE' then null else j_new end);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients','visits','visit_tests','test_results','report_versions','tests_catalog','test_prices','payments','expenses','branches','branch_workdays','daily_closings','historical_results','monthly_approvals','staff_directory','expense_categories','lab_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.capture_audit_log()',t,t);
  END LOOP;
END $$;

-- 6) WEBSITE CMS — SEPARATE FROM INTERNAL LAB SETTINGS
create table if not exists public.site_settings (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  public_content jsonb not null default '{}'::jsonb,
  theme_json jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_audit_site_settings on public.site_settings;
create trigger trg_audit_site_settings after insert or update or delete on public.site_settings
for each row execute function private.capture_audit_log();

create table if not exists public.site_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  section_key text not null,
  title text,
  content jsonb not null default '{}'::jsonb,
  layout_key text,
  display_order integer not null default 0,
  is_visible boolean not null default true,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (tenant_id, section_key)
);

create table if not exists public.site_test_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  display_name text not null,
  category text,
  description text,
  display_price numeric(12,2) check (display_price is null or display_price >= 0),
  display_order integer not null default 0,
  is_visible boolean not null default true,
  is_published boolean not null default false,
  unique (tenant_id, code)
);

create table if not exists public.site_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  title text not null,
  description text,
  display_price numeric(12,2) check (display_price is null or display_price >= 0),
  old_price numeric(12,2),
  included_tests jsonb not null default '[]'::jsonb,
  image_path text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists public.site_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  title text not null,
  slug text not null,
  excerpt text,
  body_json jsonb not null default '{}'::jsonb,
  cover_image_path text,
  author_name text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists public.site_faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  question text not null,
  answer text not null,
  display_order integer not null default 0,
  is_published boolean not null default false
);

create table if not exists public.site_testimonials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  display_name text not null,
  content text not null,
  rating smallint check (rating is null or rating between 1 and 5),
  display_order integer not null default 0,
  is_published boolean not null default false
);

create table if not exists public.site_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  title text not null,
  description text,
  discount_percent numeric(5,2) check (discount_percent is null or discount_percent between 0 and 100),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.site_branch_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  public_name text,
  public_address text,
  public_phone text,
  public_map_link text,
  display_order integer not null default 0,
  show_on_site boolean not null default false,
  is_published boolean not null default false,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  unique (tenant_id, branch_id)
);

-- 7) PLATFORM SUBSCRIPTIONS / SUPPORT (metadata only)
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null unique,
  plan_name text not null,
  price_monthly numeric(12,2) not null default 0 check (price_monthly >= 0),
  limits_json jsonb not null default '{}'::jsonb,
  features_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  plan_id uuid references public.subscription_plans(id) on delete restrict,
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','expired','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_tenant on public.subscriptions(tenant_id, status);

create table if not exists public.tenant_usage (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  storage_bytes bigint not null default 0,
  patient_count bigint not null default 0,
  visit_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  subject text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.support_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  request_id uuid references public.support_requests(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  scope text not null,
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

-- 8) PUBLIC-SAFE ACCESS HELPERS AND TENANT PROVISIONING
create or replace function private.can_read_site(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.site_settings ss where ss.tenant_id=p_tenant_id and ss.is_published)
    or private.is_tenant_owner(p_tenant_id);
$$;

create or replace function public.platform_create_tenant(
  p_name text, p_slug text, p_owner_user_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_tenant_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrator required'; end if;
  if p_owner_user_id is null or not exists (select 1 from auth.users where id=p_owner_user_id) then
    raise exception 'Valid owner Auth user required';
  end if;
  insert into public.tenants(name,slug) values (p_name,lower(p_slug)) returning id into v_tenant_id;
  insert into public.tenant_memberships(tenant_id,user_id,account_type) values (v_tenant_id,p_owner_user_id,'owner');
  insert into public.lab_settings(tenant_id,laboratory_name) values (v_tenant_id,p_name);
  insert into public.site_settings(tenant_id) values (v_tenant_id);
  insert into public.tenant_usage(tenant_id) values (v_tenant_id);
  return v_tenant_id;
end;
$$;

create or replace function public.get_public_tenant_by_slug(p_slug text)
returns table (tenant_id uuid, tenant_name text, tenant_slug text)
language sql stable security definer set search_path = pg_catalog
as $$
  select t.id,t.name,t.slug from public.tenants t
  join public.site_settings ss on ss.tenant_id=t.id
  where t.slug=lower(trim(p_slug)) and ss.is_published and t.status in ('trial','active');
$$;
revoke all on function public.get_public_tenant_by_slug(text) from public;
grant execute on function public.get_public_tenant_by_slug(text) to anon, authenticated;

-- 9) RLS ENABLEMENT
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','tenant_memberships','branches','branch_workdays','branch_memberships','staff_directory','platform_admins',
    'patients','visits','historical_results','tests_catalog','test_prices','test_parameters','visit_tests','test_results','report_versions',
    'visit_billing','payments','expense_categories','expenses','financial_ledger','daily_closings','monthly_approvals',
    'lab_settings','print_settings','audit_logs','file_metadata','sync_operations','sync_conflicts','backup_runs','portal_access_attempts',
    'site_settings','site_sections','site_test_catalog','site_packages','site_articles','site_faqs','site_testimonials','site_offers','site_branch_profiles',
    'subscription_plans','subscriptions','tenant_usage','support_requests','support_grants'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 10) RLS POLICIES (drop-if-exists makes policy section repeatable)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'tsl_%'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',p.policyname,p.schemaname,p.tablename); END LOOP;
END $$;

-- Tenant core
create policy tsl_tenants_select on public.tenants for select to authenticated using (private.is_tenant_member(id) or private.is_platform_admin());
create policy tsl_tenants_update on public.tenants for update to authenticated using (private.is_tenant_owner(id) or private.is_platform_admin()) with check (private.is_tenant_owner(id) or private.is_platform_admin());
create policy tsl_tenant_memberships_select on public.tenant_memberships for select to authenticated using (user_id=auth.uid() or private.is_tenant_owner(tenant_id) or private.is_platform_admin());
create policy tsl_tenant_memberships_owner_manage on public.tenant_memberships for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_branches_select on public.branches for select to authenticated using (private.can_access_branch(tenant_id,id));
create policy tsl_branches_owner_manage on public.branches for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_branch_workdays_branch_read on public.branch_workdays for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_branch_memberships_select on public.branch_memberships for select to authenticated using (user_id=auth.uid() or private.is_tenant_owner(tenant_id));
create policy tsl_branch_memberships_owner_manage on public.branch_memberships for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_staff_directory_select on public.staff_directory for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_staff_directory_owner_manage on public.staff_directory for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_platform_admins_self_read on public.platform_admins for select to authenticated using (user_id=auth.uid());

-- Clinical data
create policy tsl_patients_branch_access on public.patients for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_visits_branch_access on public.visits for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_historical_results_branch_access on public.historical_results for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_tests_catalog_member_read on public.tests_catalog for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_tests_catalog_member_write on public.tests_catalog for insert to authenticated with check (private.is_tenant_member(tenant_id));
create policy tsl_tests_catalog_member_update on public.tests_catalog for update to authenticated using (private.is_tenant_member(tenant_id)) with check (private.is_tenant_member(tenant_id));
create policy tsl_tests_catalog_owner_delete on public.tests_catalog for delete to authenticated using (private.is_tenant_owner(tenant_id));
create policy tsl_test_prices_member_read on public.test_prices for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_test_prices_owner_manage on public.test_prices for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_test_parameters_member_read on public.test_parameters for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_test_parameters_member_write on public.test_parameters for insert to authenticated with check (private.is_tenant_member(tenant_id));
create policy tsl_test_parameters_member_update on public.test_parameters for update to authenticated using (private.is_tenant_member(tenant_id)) with check (private.is_tenant_member(tenant_id));
create policy tsl_test_parameters_owner_delete on public.test_parameters for delete to authenticated using (private.is_tenant_owner(tenant_id));
create policy tsl_visit_tests_branch_access on public.visit_tests for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_test_results_member_access on public.test_results for all to authenticated using (private.can_access_visit_test(visit_test_id)) with check (private.can_access_visit_test(visit_test_id));
create policy tsl_report_versions_branch_read on public.report_versions for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_report_versions_branch_insert on public.report_versions for insert to authenticated with check (private.can_access_branch(tenant_id,branch_id));

-- Financial data
create policy tsl_visit_billing_branch_read on public.visit_billing for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_visit_billing_branch_insert on public.visit_billing for insert to authenticated with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_payments_branch_read on public.payments for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_expenses_branch_read on public.expenses for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_expense_categories_member_read on public.expense_categories for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_expense_categories_owner_manage on public.expense_categories for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_ledger_branch_read on public.financial_ledger for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_daily_closings_branch_read on public.daily_closings for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
create policy tsl_daily_closings_branch_insert on public.daily_closings for insert to authenticated with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_monthly_approvals_owner_manage on public.monthly_approvals for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

-- Settings and operational metadata
create policy tsl_lab_settings_member_read on public.lab_settings for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_lab_settings_owner_manage on public.lab_settings for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_print_settings_member_read on public.print_settings for select to authenticated using (private.is_tenant_member(tenant_id));
create policy tsl_print_settings_owner_manage on public.print_settings for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_audit_logs_owner_read on public.audit_logs for select to authenticated using (private.is_tenant_owner(tenant_id));
create policy tsl_file_metadata_branch_read on public.file_metadata for select to authenticated using (private.is_tenant_owner(tenant_id) or (branch_id is not null and private.can_access_branch(tenant_id,branch_id)));
create policy tsl_file_metadata_branch_insert on public.file_metadata for insert to authenticated with check (private.is_tenant_owner(tenant_id) or (branch_id is not null and private.can_access_branch(tenant_id,branch_id))); 
create policy tsl_sync_operations_branch_access on public.sync_operations for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_sync_conflicts_branch_access on public.sync_conflicts for all to authenticated using (private.can_access_branch(tenant_id,branch_id)) with check (private.can_access_branch(tenant_id,branch_id));
create policy tsl_backup_runs_owner_manage on public.backup_runs for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

-- CMS: anonymous visitors see published content only; managers edit all.
create policy tsl_site_settings_public_read on public.site_settings for select to anon using (is_published);
create policy tsl_site_settings_member_read on public.site_settings for select to authenticated using (is_published or private.is_tenant_owner(tenant_id));
create policy tsl_site_settings_owner_manage on public.site_settings for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_sections_public_read on public.site_sections for select to anon using (is_published and is_visible);
create policy tsl_site_sections_member_read on public.site_sections for select to authenticated using (is_published and is_visible or private.is_tenant_owner(tenant_id));
create policy tsl_site_sections_owner_manage on public.site_sections for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_test_catalog_public_read on public.site_test_catalog for select to anon using (is_published and is_visible);
create policy tsl_site_test_catalog_member_read on public.site_test_catalog for select to authenticated using (is_published and is_visible or private.is_tenant_owner(tenant_id));
create policy tsl_site_test_catalog_owner_manage on public.site_test_catalog for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_packages_public_read on public.site_packages for select to anon using (is_published and is_active);
create policy tsl_site_packages_member_read on public.site_packages for select to authenticated using (is_published and is_active or private.is_tenant_owner(tenant_id));
create policy tsl_site_packages_owner_manage on public.site_packages for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_articles_public_read on public.site_articles for select to anon using (is_published);
create policy tsl_site_articles_member_read on public.site_articles for select to authenticated using (is_published or private.is_tenant_owner(tenant_id));
create policy tsl_site_articles_owner_manage on public.site_articles for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_faqs_public_read on public.site_faqs for select to anon using (is_published);
create policy tsl_site_faqs_member_read on public.site_faqs for select to authenticated using (is_published or private.is_tenant_owner(tenant_id));
create policy tsl_site_faqs_owner_manage on public.site_faqs for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_testimonials_public_read on public.site_testimonials for select to anon using (is_published);
create policy tsl_site_testimonials_member_read on public.site_testimonials for select to authenticated using (is_published or private.is_tenant_owner(tenant_id));
create policy tsl_site_testimonials_owner_manage on public.site_testimonials for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_offers_public_read on public.site_offers for select to anon using (is_published and is_active);
create policy tsl_site_offers_member_read on public.site_offers for select to authenticated using (is_published and is_active or private.is_tenant_owner(tenant_id));
create policy tsl_site_offers_owner_manage on public.site_offers for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));
create policy tsl_site_branch_profiles_public_read on public.site_branch_profiles for select to anon using (show_on_site and is_published);
create policy tsl_site_branch_profiles_member_read on public.site_branch_profiles for select to authenticated using (show_on_site and is_published or private.is_tenant_owner(tenant_id));
create policy tsl_site_branch_profiles_owner_manage on public.site_branch_profiles for all to authenticated using (private.is_tenant_owner(tenant_id)) with check (private.is_tenant_owner(tenant_id));

-- Platform-only metadata; tenants see only their own subscription/usage summary.
create policy tsl_platform_admins_manage on public.platform_admins for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tsl_subscription_plans_public_active on public.subscription_plans for select to anon, authenticated using (is_active);
create policy tsl_subscription_plans_platform_manage on public.subscription_plans for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tsl_subscriptions_tenant_read on public.subscriptions for select to authenticated using (private.is_tenant_owner(tenant_id) or private.is_platform_admin());
create policy tsl_subscriptions_platform_manage on public.subscriptions for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tsl_tenant_usage_owner_or_platform_read on public.tenant_usage for select to authenticated using (private.is_tenant_owner(tenant_id) or private.is_platform_admin());
create policy tsl_tenant_usage_platform_manage on public.tenant_usage for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tsl_support_requests_owner_access on public.support_requests for all to authenticated using (private.is_tenant_owner(tenant_id) or private.is_platform_admin()) with check (private.is_tenant_owner(tenant_id) or private.is_platform_admin());
create policy tsl_support_grants_owner_or_platform_read on public.support_grants for select to authenticated using (private.is_tenant_owner(tenant_id) or private.is_platform_admin());
create policy tsl_support_grants_owner_insert on public.support_grants for insert to authenticated with check (private.is_tenant_owner(tenant_id));
create policy tsl_support_grants_platform_revoke on public.support_grants for update to authenticated using (private.is_platform_admin() or private.is_tenant_owner(tenant_id)) with check (private.is_platform_admin() or private.is_tenant_owner(tenant_id));

create or replace function private.can_access_report_path(p_tenant_id uuid, p_visit_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.visits v where v.id=p_visit_id and v.tenant_id=p_tenant_id
    and private.can_access_branch(v.tenant_id,v.branch_id));
$$;

-- 11) STORAGE BUCKETS AND POLICIES
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tenant-reports','tenant-reports',false,10485760,array['application/pdf']),
  ('tenant-attachments','tenant-attachments',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']),
  ('tenant-site-assets','tenant-site-assets',true,10485760,array['image/jpeg','image/png','image/webp']),
  ('tenant-backups','tenant-backups',false,104857600,array['application/zip','application/json','text/csv'])
on conflict (id) do nothing;

-- Paths: reports/<tenant_uuid>/<visit_uuid>/<file>.pdf
--        attachments/<tenant_uuid>/<branch_uuid>/<file>
--        site assets/<tenant_uuid>/<file>
--        backups/<tenant_uuid>/<file>
drop policy if exists tsl_reports_read_authorized on storage.objects;
drop policy if exists tsl_reports_upload_authorized on storage.objects;
drop policy if exists tsl_reports_delete_owner on storage.objects;
drop policy if exists tsl_attachments_read_authorized on storage.objects;
drop policy if exists tsl_attachments_upload_authorized on storage.objects;
drop policy if exists tsl_attachments_delete_owner on storage.objects;
drop policy if exists tsl_site_assets_public_read on storage.objects;
drop policy if exists tsl_site_assets_owner_upload on storage.objects;
drop policy if exists tsl_site_assets_owner_update on storage.objects;
drop policy if exists tsl_site_assets_owner_delete on storage.objects;
drop policy if exists tsl_backups_owner_read on storage.objects;
drop policy if exists tsl_backups_owner_upload on storage.objects;
drop policy if exists tsl_backups_owner_delete on storage.objects;

create policy tsl_reports_read_authorized on storage.objects for select to authenticated
using (bucket_id='tenant-reports' and private.can_access_report_path((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy tsl_reports_upload_authorized on storage.objects for insert to authenticated
with check (bucket_id='tenant-reports' and private.can_access_report_path((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy tsl_reports_delete_owner on storage.objects for delete to authenticated
using (bucket_id='tenant-reports' and private.can_access_report_path((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid) and private.is_tenant_owner((storage.foldername(name))[1]::uuid));

create policy tsl_attachments_read_authorized on storage.objects for select to authenticated
using (bucket_id='tenant-attachments' and private.can_access_branch((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy tsl_attachments_upload_authorized on storage.objects for insert to authenticated
with check (bucket_id='tenant-attachments' and private.can_access_branch((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy tsl_attachments_delete_owner on storage.objects for delete to authenticated
using (bucket_id='tenant-attachments' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));

create policy tsl_site_assets_public_read on storage.objects for select to anon, authenticated using (bucket_id='tenant-site-assets');
create policy tsl_site_assets_owner_upload on storage.objects for insert to authenticated
with check (bucket_id='tenant-site-assets' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));
create policy tsl_site_assets_owner_update on storage.objects for update to authenticated
using (bucket_id='tenant-site-assets' and private.is_tenant_owner((storage.foldername(name))[1]::uuid))
with check (bucket_id='tenant-site-assets' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));
create policy tsl_site_assets_owner_delete on storage.objects for delete to authenticated
using (bucket_id='tenant-site-assets' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));

create policy tsl_backups_owner_read on storage.objects for select to authenticated
using (bucket_id='tenant-backups' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));
create policy tsl_backups_owner_upload on storage.objects for insert to authenticated
with check (bucket_id='tenant-backups' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));
create policy tsl_backups_owner_delete on storage.objects for delete to authenticated
using (bucket_id='tenant-backups' and private.is_tenant_owner((storage.foldername(name))[1]::uuid));

-- 12) TABLE GRANTS: RLS is still the row-level enforcement layer.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Authenticated users need table privileges; policies constrain rows.
grant select on public.tenants, public.tenant_memberships, public.branches, public.branch_memberships,
  public.staff_directory, public.branch_workdays, public.patients, public.visits, public.historical_results, public.tests_catalog, public.test_prices,
  public.test_parameters, public.visit_tests, public.test_results, public.report_versions,
  public.visit_billing, public.payments, public.expense_categories, public.expenses,
  public.financial_ledger, public.daily_closings, public.monthly_approvals,
  public.lab_settings, public.print_settings, public.audit_logs, public.file_metadata, public.sync_operations,
  public.sync_conflicts, public.backup_runs, public.site_settings, public.site_sections,
  public.site_test_catalog, public.site_packages, public.site_articles, public.site_faqs,
  public.site_testimonials, public.site_offers, public.site_branch_profiles,
  public.subscription_plans, public.subscriptions, public.tenant_usage,
  public.support_requests, public.support_grants, public.platform_admins
 to authenticated;

grant insert, update on public.patients, public.visits, public.historical_results, public.visit_tests, public.test_results,
  public.sync_operations, public.sync_conflicts to authenticated;
grant insert on public.visit_billing, public.report_versions, public.file_metadata to authenticated;
grant insert, update, delete on public.tests_catalog, public.test_parameters to authenticated;
grant insert, update, delete on public.branches, public.tenant_memberships, public.branch_memberships,
  public.staff_directory, public.test_prices, public.expense_categories,
  public.lab_settings, public.print_settings, public.monthly_approvals,
  public.site_settings, public.site_sections, public.site_test_catalog, public.site_packages,
  public.site_articles, public.site_faqs, public.site_testimonials, public.site_offers,
  public.site_branch_profiles, public.backup_runs, public.subscription_plans, public.subscriptions, public.tenant_usage to authenticated;
grant insert, update, delete on public.support_requests to authenticated;
grant insert on public.support_grants to authenticated;
grant update on public.support_grants to authenticated;
grant select on public.site_settings, public.site_sections, public.site_test_catalog,
  public.site_packages, public.site_articles, public.site_faqs, public.site_testimonials,
  public.site_offers, public.site_branch_profiles, public.subscription_plans to anon;

-- RPC-only write paths for payments and expenses; ledger has no direct write grant.
revoke all on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) from public, anon;
revoke all on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) from public, anon;
revoke all on function public.platform_create_tenant(text,text,uuid) from public, anon;
grant execute on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) to authenticated;
grant execute on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) to authenticated;
grant execute on function public.platform_create_tenant(text,text,uuid) to authenticated;
revoke all on function public.open_branch_workday(uuid,uuid,date,uuid) from public, anon;
grant execute on function public.open_branch_workday(uuid,uuid,date,uuid) to authenticated;
revoke all on function public.close_branch_workday(uuid,uuid,date,uuid) from public, anon;
grant execute on function public.close_branch_workday(uuid,uuid,date,uuid) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function private.is_tenant_member(uuid) from public, anon, authenticated;
revoke all on function private.is_tenant_owner(uuid) from public, anon, authenticated;
revoke all on function private.can_access_branch(uuid,uuid) from public, anon, authenticated;
revoke all on function private.can_access_visit(uuid) from public, anon, authenticated;
revoke all on function private.can_access_visit_test(uuid) from public, anon, authenticated;
revoke all on function private.can_access_report_path(uuid,uuid) from public, anon, authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.is_tenant_owner(uuid) to authenticated;
grant execute on function private.can_access_branch(uuid,uuid) to authenticated;
grant execute on function private.can_access_visit(uuid) to authenticated;
grant execute on function private.can_access_visit_test(uuid) to authenticated;
grant execute on function private.can_access_report_path(uuid,uuid) to authenticated;

-- 13) UPDATED_AT TRIGGERS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','branches','patients','visits','historical_results','tests_catalog','test_prices','test_parameters','lab_settings','print_settings','site_sections','subscriptions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()',t,t);
  END LOOP;
END $$;

-- 14) SECURITY / SCHEMA ASSERTIONS — fail the transaction if a core table lacks RLS.
DO $$
DECLARE t text; missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','tenant_memberships','branches','branch_workdays','branch_memberships','staff_directory','patients','visits',
    'tests_catalog','test_prices','test_parameters','visit_tests','test_results','report_versions',
    'visit_billing','payments','expense_categories','expenses','financial_ledger','daily_closings',
    'monthly_approvals','lab_settings','print_settings','audit_logs','file_metadata','sync_operations','sync_conflicts',
    'backup_runs','portal_access_attempts','site_settings','site_sections','site_test_catalog','site_packages','site_articles',
    'site_faqs','site_testimonials','site_offers','site_branch_profiles','subscriptions','tenant_usage',
    'support_requests','support_grants','platform_admins'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN missing := array_append(missing,t); END IF;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'RLS verification failed for: %', array_to_string(missing, ', ');
  END IF;
END $$;

-- Record installed schema version.
create table if not exists public.schema_migrations (
  version text primary key,
  description text not null,
  installed_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
alter table public.schema_migrations force row level security;
revoke all on public.schema_migrations from public, anon, authenticated;
insert into public.schema_migrations(version,description)
values ('1.0.0','Initial Taiba Smart Lab multi-tenant schema')
on conflict (version) do nothing;

commit;

/*
POST-INSTALL NOTES
1) Bootstrap first platform admin explicitly (see README_AR.md).
2) Create Auth users in Supabase Auth; never store passwords in public tables.
3) Provision tenants through platform_create_tenant after platform-admin bootstrap.
4) Create branches, employee Auth users, tenant_memberships, and branch_memberships
   through a secured provisioning workflow before enabling front-end access.
5) Patient portal lookup must be implemented through a rate-limited Edge Function;
   do not grant anon direct SELECT on patients, visits, or reports.
6) Backup export/restore orchestration and signed report URLs require application/
   Edge Function code; this schema stores metadata and enforces storage access.
7) Before production, perform the separate RLS test matrix in VERIFY_AFTER_INSTALL.sql.
*/
