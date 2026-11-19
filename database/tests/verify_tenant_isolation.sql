-- Disposable local-only RLS isolation test.
-- All synthetic Auth users, tenants, branches and patients are rolled back.
begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
 ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','rls-owner-a@example.invalid','not-a-real-password',now(),'{}'::jsonb,'{}'::jsonb),
 ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','rls-employee-a1@example.invalid','not-a-real-password',now(),'{}'::jsonb,'{}'::jsonb),
 ('a1000000-0000-4000-8000-000000000003','authenticated','authenticated','rls-employee-a2@example.invalid','not-a-real-password',now(),'{}'::jsonb,'{}'::jsonb),
 ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','rls-owner-b@example.invalid','not-a-real-password',now(),'{}'::jsonb,'{}'::jsonb),
 ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','rls-employee-b1@example.invalid','not-a-real-password',now(),'{}'::jsonb,'{}'::jsonb);

insert into public.tenants (id,name,slug,status) values
 ('aa000000-0000-4000-8000-000000000001','RLS Test Lab A','rls-test-lab-a','active'),
 ('bb000000-0000-4000-8000-000000000001','RLS Test Lab B','rls-test-lab-b','active');

insert into public.branches (id,tenant_id,name) values
 ('aa100000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','A Branch 1'),
 ('aa100000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001','A Branch 2'),
 ('bb100000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','B Branch 1');

insert into public.tenant_memberships (tenant_id,user_id,account_type,is_active) values
 ('aa000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner',true),
 ('aa000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','employee',true),
 ('aa000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','employee',true),
 ('bb000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner',true),
 ('bb000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','employee',true);

insert into public.branch_memberships (tenant_id,branch_id,user_id,is_active) values
 ('aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',true),
 ('aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003',true),
 ('bb000000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',true);

insert into public.staff_directory (id,tenant_id,branch_id,display_name,auth_user_id,is_active) values
 ('aa200000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','A Employee 1','a1000000-0000-4000-8000-000000000002',true),
 ('aa200000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000002','A Employee 2','a1000000-0000-4000-8000-000000000003',true),
 ('bb200000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','B Employee 1','b1000000-0000-4000-8000-000000000002',true);

insert into public.patients (id,tenant_id,branch_id,patient_number,full_name) values
 ('aa300000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','RLS-A1-001','RLS Patient A1'),
 ('aa300000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000002','RLS-A2-001','RLS Patient A2'),
 ('bb300000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','RLS-B1-001','RLS Patient B1');

-- Tenant A owner must see both branches and patients in A, but nothing in B.
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.tenants) <> 1 then raise exception 'RLS FAIL: Tenant A owner tenant isolation'; end if;
 if (select count(*) from public.branches) <> 2 then raise exception 'RLS FAIL: Tenant A owner branch scope'; end if;
 if (select count(*) from public.patients) <> 2 then raise exception 'RLS FAIL: Tenant A owner patient scope'; end if;
end $$;
reset role;

-- Branch A1 employee must not see branch A2 or any Tenant B rows.
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.tenants) <> 1 then raise exception 'RLS FAIL: Employee A1 tenant scope'; end if;
 if (select count(*) from public.branches) <> 1 then raise exception 'RLS FAIL: Employee A1 branch scope'; end if;
 if (select count(*) from public.patients) <> 1 then raise exception 'RLS FAIL: Employee A1 patient scope'; end if;
 if not exists (select 1 from public.patients where id='aa300000-0000-4000-8000-000000000001') then raise exception 'RLS FAIL: Employee A1 cannot see own patient'; end if;
 if exists (select 1 from public.patients where id<>'aa300000-0000-4000-8000-000000000001') then raise exception 'RLS FAIL: Employee A1 sees foreign patient'; end if;
end $$;
reset role;

-- Snapshot synthetic row counts before archiving; this temp table is transaction-local.
create temporary table branch_archive_counts_before(table_name text primary key, row_count bigint) on commit drop;
insert into branch_archive_counts_before values
 ('branches',(select count(*) from public.branches)),
 ('tenant_memberships',(select count(*) from public.tenant_memberships)),
 ('branch_memberships',(select count(*) from public.branch_memberships)),
 ('staff_directory',(select count(*) from public.staff_directory)),
 ('patients',(select count(*) from public.patients)),
 ('visits',(select count(*) from public.visits)),
 ('test_results',(select count(*) from public.test_results)),
 ('payments',(select count(*) from public.payments)),
 ('financial_ledger',(select count(*) from public.financial_ledger));

-- Archive A1 as the privileged test harness would. No related rows are changed.
do $archive$
begin
  update public.branches set is_active=false
   where id='aa100000-0000-4000-8000-000000000001'
     and tenant_id='aa000000-0000-4000-8000-000000000001';
  if not found then
    raise exception 'RLS FAIL: could not mark synthetic branch A1 inactive';
  end if;
end $archive$;

-- Tenant A owner retains access to archived branch metadata and historical patients.
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $archive$
begin
 if not private.can_access_branch('aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: owner lost archived branch access';
 end if;
 if not exists (select 1 from public.branches where id='aa100000-0000-4000-8000-000000000001' and is_active=false) then
   raise exception 'RLS FAIL: owner cannot read archived branch';
 end if;
 if not exists (select 1 from public.patients where id='aa300000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: owner cannot read archived branch patient history';
 end if;
end $archive$;
reset role;

-- The former branch employee must lose access through every policy that
-- directly or transitively calls can_access_branch (public and Storage).
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $archive$
declare
  visible_rows bigint;
  policy_row record;
begin
 if private.can_access_branch('aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: employee helper still grants archived branch access';
 end if;
 if exists (select 1 from public.branches where id='aa100000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: employee can read archived branch metadata';
 end if;
 if exists (select 1 from public.patients where id='aa300000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: employee can read archived branch patient history';
 end if;

 for policy_row in
   with recursive helper_functions(schema_name,function_name) as (
     select n.nspname, p.proname
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prosrc ilike '%can_access_branch%'
     union
     select n.nspname, p.proname
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       join helper_functions h on p.prosrc ilike '%' || h.function_name || '%'
      where n.nspname in ('public','private')
   )
   select distinct pol.schemaname, pol.tablename
     from pg_policies pol
     join helper_functions h
       on (coalesce(pol.qual,'') || ' ' || coalesce(pol.with_check,'')) ilike '%' || h.function_name || '%'
    where pol.schemaname in ('public','storage')
      and pol.cmd in ('SELECT','ALL')
 loop
   begin
     execute format('select count(*) from %I.%I',policy_row.schemaname,policy_row.tablename)
        into visible_rows;
   exception when insufficient_privilege then
     -- No table privilege is itself an effective denial for this employee.
     visible_rows := 0;
   end;
   if visible_rows <> 0 then
     raise exception 'RLS FAIL: employee sees % rows through dependent policy on %.%',
       visible_rows, policy_row.schemaname, policy_row.tablename;
   end if;
 end loop;
end $archive$;
reset role;

-- Verify no synthetic branch, membership, staff, patient, visit, result or
-- financial rows were inserted/deleted/rewritten by the access-policy change.
do $archive$
declare
  item record;
  current_count bigint;
begin
 for item in select table_name,row_count from branch_archive_counts_before loop
   execute format('select count(*) from public.%I',item.table_name) into current_count;
   if current_count <> item.row_count then
     raise exception 'DATA INTEGRITY FAIL: % count changed from % to %',
       item.table_name,item.row_count,current_count;
   end if;
 end loop;
 if not exists (select 1 from public.branches where id='aa100000-0000-4000-8000-000000000001' and is_active=false) then
   raise exception 'DATA INTEGRITY FAIL: archived branch ID/status missing';
 end if;
 if not exists (select 1 from public.patients where id='aa300000-0000-4000-8000-000000000001') then
   raise exception 'DATA INTEGRITY FAIL: patient ID changed or row missing';
 end if;
end $archive$;

-- Tenant B employee must see only Tenant B and its one branch.
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.tenants) <> 1 then raise exception 'RLS FAIL: Tenant B isolation'; end if;
 if not exists (select 1 from public.tenants where id='bb000000-0000-4000-8000-000000000001') then raise exception 'RLS FAIL: Tenant B owner data missing'; end if;
 if (select count(*) from public.branches) <> 1 then raise exception 'RLS FAIL: Employee B1 branch scope'; end if;
 if (select count(*) from public.patients) <> 1 then raise exception 'RLS FAIL: Employee B1 patient scope'; end if;
end $$;
reset role;

rollback;
