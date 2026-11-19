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

-- Seed representative clinical, operational and financial history for A1.
-- Every row is synthetic and remains inside this transaction, which ends in ROLLBACK.
insert into public.branch_workdays(id,tenant_id,branch_id,work_date,status,opened_by)
values ('aa400000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        date '2026-11-19','open',
        'a1000000-0000-4000-8000-000000000002');

insert into public.tests_catalog(id,tenant_id,code,name)
values ('aa500000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001','RLS-TST-001','Synthetic RLS test');

insert into public.test_prices(id,tenant_id,test_id,selling_price,is_current)
values ('aa510000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa500000-0000-4000-8000-000000000001',100,true);

insert into public.test_parameters(id,tenant_id,test_id,parameter_code,parameter_name,value_type,is_required)
values ('aa520000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa500000-0000-4000-8000-000000000001',
        'RLS-PARAM','Synthetic parameter','text',true);

insert into public.visits(id,tenant_id,branch_id,patient_id,workday_id,visit_number,created_by)
values ('aa600000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa300000-0000-4000-8000-000000000001',
        'aa400000-0000-4000-8000-000000000001',
        'RLS-VISIT-A1-001',
        'a1000000-0000-4000-8000-000000000002');

update public.branch_workdays
   set status='closed'
 where id='aa400000-0000-4000-8000-000000000001';

insert into public.visit_tests(id,tenant_id,branch_id,visit_id,test_id,test_code_snapshot,test_name_snapshot,created_by)
values ('aa700000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',
        'aa500000-0000-4000-8000-000000000001',
        'RLS-TST-001','Synthetic RLS test',
        'a1000000-0000-4000-8000-000000000002');

insert into public.test_results(id,tenant_id,visit_test_id,parameter_code,parameter_name_snapshot,value_text,entered_by)
values ('aa900000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa700000-0000-4000-8000-000000000001',
        'RLS-PARAM','Synthetic parameter','synthetic-result',
        'a1000000-0000-4000-8000-000000000002');

insert into public.visit_billing(id,tenant_id,branch_id,visit_id,gross_total,discount_amount)
values ('ab000000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',100,0);

insert into public.payments(id,tenant_id,branch_id,visit_id,amount,idempotency_key,received_by,workday_id)
values ('ab100000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',50,
        'ab100000-0000-4000-8000-000000000002',
        'a1000000-0000-4000-8000-000000000002',
        'aa400000-0000-4000-8000-000000000001');

-- Payment and expense triggers create the corresponding synthetic ledger rows.

insert into public.expense_categories(id,tenant_id,name)
values ('ab300000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001','Synthetic RLS category');

insert into public.expenses(id,tenant_id,branch_id,category_id,amount,idempotency_key,spent_by,workday_id)
values ('ab400000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'ab300000-0000-4000-8000-000000000001',10,
        'ab400000-0000-4000-8000-000000000002',
        'a1000000-0000-4000-8000-000000000002',
        'aa400000-0000-4000-8000-000000000001');

insert into public.daily_closings(id,tenant_id,branch_id,workday_id,work_date,closing_snapshot)
values ('ab500000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa400000-0000-4000-8000-000000000001',
        date '2026-11-19','{"synthetic":true}'::jsonb);

insert into public.report_versions(id,tenant_id,branch_id,visit_id,version_number,storage_path,report_snapshot)
values ('ab600000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',1,
        'synthetic/rls-test/report.pdf','{"synthetic":true}'::jsonb);

insert into public.historical_results(id,tenant_id,branch_id,patient_id,patient_name_snapshot,test_code,test_name_snapshot,result_date,result_data)
values ('ab700000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa300000-0000-4000-8000-000000000001',
        'RLS Patient A1','RLS-TST-001','Synthetic RLS test',
        date '2026-11-19','{"synthetic":true}'::jsonb);

insert into public.file_metadata(id,tenant_id,branch_id,related_visit_id,bucket_id,storage_path,file_kind)
values ('ab800000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',
        'tenant-attachments','synthetic/rls-test/attachment.pdf','attachment');

insert into public.sync_operations(id,tenant_id,branch_id,operation_id,operation_type,status)
values ('ab900000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'ab900000-0000-4000-8000-000000000002','patient.create','applied');

insert into public.sync_conflicts(id,tenant_id,branch_id,operation_id,entity_type,entity_id,local_payload,server_payload)
values ('aba00000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'ab900000-0000-4000-8000-000000000002',
        'patient','aa300000-0000-4000-8000-000000000001',
        '{"synthetic":"local"}'::jsonb,'{"synthetic":"server"}'::jsonb);

insert into public.audit_logs(id,tenant_id,branch_id,actor_user_id,action,table_name,record_id)
values ('abb00000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002',
        'synthetic-test','patients','aa300000-0000-4000-8000-000000000001');

-- Synthetic objects exercise the Storage read/upload/delete policies too.
insert into storage.objects(id,bucket_id,name,owner,metadata)
values
 ('abc00000-0000-4000-8000-000000000001','tenant-reports',
  'aa000000-0000-4000-8000-000000000001/aa600000-0000-4000-8000-000000000001/synthetic.pdf',
  'a1000000-0000-4000-8000-000000000002',
  '{"mimetype":"application/pdf","size":1}'::jsonb),
 ('abc00000-0000-4000-8000-000000000002','tenant-attachments',
  'aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/synthetic.pdf',
  'a1000000-0000-4000-8000-000000000002',
  '{"mimetype":"application/pdf","size":1}'::jsonb);

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
 ('branch_workdays',(select count(*) from public.branch_workdays)),
 ('visits',(select count(*) from public.visits)),
 ('visit_tests',(select count(*) from public.visit_tests)),
 ('test_results',(select count(*) from public.test_results)),
 ('visit_billing',(select count(*) from public.visit_billing)),
 ('payments',(select count(*) from public.payments)),
 ('financial_ledger',(select count(*) from public.financial_ledger)),
 ('expenses',(select count(*) from public.expenses)),
 ('daily_closings',(select count(*) from public.daily_closings)),
 ('report_versions',(select count(*) from public.report_versions)),
 ('historical_results',(select count(*) from public.historical_results)),
 ('file_metadata',(select count(*) from public.file_metadata)),
 ('sync_operations',(select count(*) from public.sync_operations)),
 ('sync_conflicts',(select count(*) from public.sync_conflicts)),
 ('audit_logs',(select count(*) from public.audit_logs));

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
 if not exists (select 1 from storage.objects where name='aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/synthetic.pdf') then
   raise exception 'RLS FAIL: owner cannot read archived branch attachment';
 end if;
 if not exists (select 1 from storage.objects where name='aa000000-0000-4000-8000-000000000001/aa600000-0000-4000-8000-000000000001/synthetic.pdf') then
   raise exception 'RLS FAIL: owner cannot read archived branch report object';
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
  policy_count integer := 0;
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
 if exists (select 1 from public.audit_logs where id='abb00000-0000-4000-8000-000000000001') then
   raise exception 'RLS FAIL: employee can read owner-only audit history';
 end if;
 if exists (select 1 from storage.objects where name='aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/synthetic.pdf') then
   raise exception 'RLS FAIL: employee can read archived branch attachment';
 end if;
 if exists (select 1 from storage.objects where name='aa000000-0000-4000-8000-000000000001/aa600000-0000-4000-8000-000000000001/synthetic.pdf') then
   raise exception 'RLS FAIL: employee can read archived branch report object';
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
 loop
   policy_count := policy_count + 1;
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
 if policy_count = 0 then
   raise exception 'RLS FAIL: no direct or transitive policies reference can_access_branch';
 end if;
end $archive$;

-- Exercise direct employee write paths against the archived synthetic patient.
-- RLS denial must block UPDATE, DELETE and INSERT; no real rows are involved.
do $archive$
declare
  affected integer := 0;
begin
  begin
    update public.patients
       set full_name=full_name
     where id='aa300000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
  exception when insufficient_privilege then
    affected := 0;
  end;
  if affected <> 0 then
    raise exception 'RLS FAIL: employee can update archived branch patient';
  end if;

  begin
    delete from public.patients
     where id='aa300000-0000-4000-8000-000000000001';
    get diagnostics affected = row_count;
  exception when insufficient_privilege then
    affected := 0;
  end;
  if affected <> 0 then
    raise exception 'RLS FAIL: employee can delete archived branch patient';
  end if;

  begin
    delete from storage.objects
     where name='aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/synthetic.pdf';
    get diagnostics affected = row_count;
  exception when insufficient_privilege then
    affected := 0;
  end;
  if affected <> 0 then
    raise exception 'RLS FAIL: employee can delete archived branch attachment';
  end if;

  begin
    insert into storage.objects(bucket_id,name,owner,metadata)
    values ('tenant-attachments',
            'aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/employee-upload.pdf',
            'a1000000-0000-4000-8000-000000000002',
            '{"mimetype":"application/pdf","size":1}'::jsonb);
    raise exception 'RLS FAIL: employee can upload attachment into archived branch';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.patients(id,tenant_id,branch_id,patient_number,full_name)
    values ('aa300000-0000-4000-8000-000000000099',
            'aa000000-0000-4000-8000-000000000001',
            'aa100000-0000-4000-8000-000000000001',
            'RLS-A1-INSERT-BLOCK','Should be rejected by RLS');
    raise exception 'RLS FAIL: employee can insert patient into archived branch';
  exception when insufficient_privilege then
    null;
  end;
  if not exists (select 1 from storage.objects where name='aa000000-0000-4000-8000-000000000001/aa100000-0000-4000-8000-000000000001/synthetic.pdf') then
    raise exception 'DATA INTEGRITY FAIL: employee delete changed archived attachment';
  end if;

  -- RPC-only writes must reject the archived branch before touching billing,
  -- expense or offline-intake data.
  declare
    denied boolean;
  begin
    denied := false;
    begin
      perform public.record_patient_payment(
        'aa000000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',
        1,'cash','abd00000-0000-4000-8000-000000000001',
        'aa200000-0000-4000-8000-000000000001',null
      );
    exception when others then
      if sqlerrm = 'Visit not accessible' then denied := true; else raise; end if;
    end;
    if not denied then raise exception 'RLS FAIL: payment RPC accepted archived branch'; end if;

    denied := false;
    begin
      perform public.record_branch_expense(
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'ab300000-0000-4000-8000-000000000001',
        1,'synthetic denied expense',
        'abd00000-0000-4000-8000-000000000002',
        'aa200000-0000-4000-8000-000000000001'
      );
    exception when others then
      if sqlerrm = 'Branch not accessible' then denied := true; else raise; end if;
    end;
    if not denied then raise exception 'RLS FAIL: expense RPC accepted archived branch'; end if;

    denied := false;
    begin
      perform public.create_visit_intake_idempotent(
        'abd00000-0000-4000-8000-000000000003',
        'aa000000-0000-4000-8000-000000000001',
        'aa100000-0000-4000-8000-000000000001',
        'aa300000-0000-4000-8000-000000000001',
        'RLS-OFFLINE-DENIED',
        'aa200000-0000-4000-8000-000000000001',
        array[]::uuid[],0,0,'cash',null,null,'[]'::jsonb
      );
    exception when others then
      if sqlerrm = 'Branch not accessible' then denied := true; else raise; end if;
    end;
    if not denied then raise exception 'RLS FAIL: offline intake RPC accepted archived branch'; end if;
  end;
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
