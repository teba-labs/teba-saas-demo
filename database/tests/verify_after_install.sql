/* Taiba Smart Lab — post-install structural/security checks
   Run only after taiba_smart_lab_schema_v1.sql completes successfully.
   Read-only: this file does not insert, update, or delete application data.
*/

-- 1) Installed schema version
select version, description, installed_at
from public.schema_migrations
order by installed_at desc;

-- 2) All public base tables must have RLS enabled.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname;

-- 3) Policies created by this build.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where policyname like 'tsl_%'
order by schemaname, tablename, policyname;

-- 4) Protected clinical tables must not be readable directly by anon.
select
  has_table_privilege('anon','public.patients','SELECT') as anon_can_read_patients,
  has_table_privilege('anon','public.visits','SELECT') as anon_can_read_visits,
  has_table_privilege('anon','public.test_results','SELECT') as anon_can_read_results,
  has_table_privilege('anon','public.report_versions','SELECT') as anon_can_read_reports,
  has_table_privilege('anon','public.portal_access_attempts','SELECT') as anon_can_read_portal_attempts;

-- 5) Financial writes must use the secured RPCs, not direct table writes.
select
  has_table_privilege('authenticated','public.payments','INSERT') as client_can_insert_payments,
  has_table_privilege('authenticated','public.expenses','INSERT') as client_can_insert_expenses,
  has_table_privilege('authenticated','public.financial_ledger','INSERT') as client_can_insert_ledger,
  has_table_privilege('authenticated','public.financial_ledger','UPDATE') as client_can_update_ledger,
  has_table_privilege('authenticated','public.branch_workdays','INSERT') as client_can_insert_workdays;

-- 6) RPCs expected by the first integration stage.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in (
  'get_public_tenant_by_slug','platform_create_tenant','record_patient_payment',
  'record_branch_expense','open_branch_workday','close_branch_workday'
)) or (n.nspname='private' and p.proname in (
  'is_platform_admin','is_tenant_member','is_tenant_owner','can_access_branch','can_access_visit','can_access_visit_test','can_access_report_path'
))
order by n.nspname,p.proname;

-- 7) Storage buckets and privacy settings.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('tenant-reports','tenant-attachments','tenant-site-assets','tenant-backups')
order by id;

-- 8) Storage policies created by this build.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='storage' and policyname like 'tsl_%'
order by tablename, policyname;

-- 9) Automated assertions: raises an error if a critical condition is missing.
do $$
declare missing text[] := array[]::text[];
begin
  if not exists (select 1 from public.schema_migrations where version='1.0.0') then
    missing := array_append(missing,'schema_migrations 1.0.0');
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
  ) then missing := array_append(missing,'one or more public tables have RLS disabled'); end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relforcerowsecurity
  ) then missing := array_append(missing,'one or more public tables do not FORCE RLS'); end if;
  if has_table_privilege('anon','public.patients','SELECT')
     or has_table_privilege('anon','public.visits','SELECT')
     or has_table_privilege('anon','public.test_results','SELECT') then
    missing := array_append(missing,'anon has direct clinical table SELECT privilege');
  end if;
  if has_table_privilege('authenticated','public.financial_ledger','INSERT')
     or has_table_privilege('authenticated','public.financial_ledger','UPDATE') then
    missing := array_append(missing,'authenticated can directly write financial_ledger');
  end if;
  if not exists (select 1 from storage.buckets where id='tenant-reports' and public=false) then
    missing := array_append(missing,'private tenant-reports bucket');
  end if;
  if not exists (select 1 from storage.buckets where id='tenant-backups' and public=false) then
    missing := array_append(missing,'private tenant-backups bucket');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='open_branch_workday') then
    missing := array_append(missing,'open_branch_workday RPC');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='close_branch_workday') then
    missing := array_append(missing,'close_branch_workday RPC');
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='offline_visit_intake_receipts'
      and c.relrowsecurity
  ) then missing := array_append(missing,'private offline receipt table RLS'); end if;
  if has_table_privilege('anon','private.offline_visit_intake_receipts','SELECT')
     or has_table_privilege('authenticated','private.offline_visit_intake_receipts','SELECT') then
    missing := array_append(missing,'client role can directly read private offline receipts');
  end if;
  if cardinality(missing)>0 then
    raise exception 'Post-install verification failed: %', array_to_string(missing, '; ');
  end if;
  raise notice 'Structural checks passed. Manual tenant/branch RLS tests are still required.';
end $$;


-- Owner print settings must write into the same metadata-only audit stream.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.print_settings'::regclass
      AND tgname = 'trg_audit_print_settings'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Missing print settings audit trigger';
  END IF;
END $$;
