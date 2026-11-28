-- Real Supabase integration smoke for the isolated Test1 tenant.
-- All rows, workday changes, portal settings, and report metadata are rolled back.
-- Run against teba-lis-demo only after verifying the test1-lab tenant exists.
begin;
create temp table cycle2_test_output(details jsonb) on commit drop;
grant insert,select on cycle2_test_output to authenticated;
select set_config('request.jwt.claim.sub',(
  select tm.user_id::text
  from public.tenants t
  join public.tenant_memberships tm on tm.tenant_id=t.id
  where t.slug='test1-lab' and tm.account_type='owner' and tm.is_active
  order by tm.created_at limit 1
),true);
set local role authenticated;

do $cycle$
declare
  v_tenant uuid;
  v_branch uuid;
  v_user uuid := auth.uid();
  v_staff uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_test uuid;
  v_price uuid;
  v_paid_test uuid;
  v_paid_price uuid;
  v_paid_amount numeric;
  v_paid_visit uuid;
  v_paid_visit_op uuid := gen_random_uuid();
  v_payment_op uuid := gen_random_uuid();
  v_payment_id uuid;
  v_payment_retry uuid;
  v_payment_count integer;
  v_visit_op uuid := gen_random_uuid();
  v_results_op uuid := gen_random_uuid();
  v_visit uuid;
  v_visit_retry uuid;
  v_price_conflict_rejected boolean := false;
  v_visit_test uuid;
  v_results jsonb := jsonb_build_array(
    jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',100,'value_text',null,'flag','normal'),
    jsonb_build_object('parameter_code','FASTING_INSULIN','value_numeric',10.0,'value_text',null,'flag','normal')
  );
  v_ids uuid[];
  v_retry_ids uuid[];
  v_count integer;
  v_report_id uuid;
  v_work_date date;
  v_workday uuid;
  v_report_path text;
begin
  select t.id,b.id into v_tenant,v_branch
  from public.tenants t
  join public.branches b on b.tenant_id=t.id and b.is_active
  where t.slug='test1-lab'
  order by b.created_at limit 1;
  if v_tenant is null or v_branch is null or v_user is null then
    raise exception 'TEST BLOCKED: Test1 tenant, branch, or active owner account is missing';
  end if;
  if not exists(select 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_user and account_type='owner' and is_active) then
    raise exception 'TEST BLOCKED: selected account is not the Test1 owner';
  end if;
  select tc.id,tp.id into v_test,v_price
  from public.tests_catalog tc
  join public.test_prices tp on tp.tenant_id=tc.tenant_id and tp.test_id=tc.id and tp.is_current
    and (tp.branch_id=v_branch or tp.branch_id is null)
  where tc.tenant_id=v_tenant and tc.code='HOMA_IR' and tc.is_active and tp.selling_price=0
  order by (tp.branch_id is not null) desc limit 1;
  if v_test is null or v_price is null then
    raise exception 'TEST BLOCKED: zero-price HOMA_IR catalog item and current price snapshot are required';
  end if;
  select tc.id,tp.id,tp.selling_price into v_paid_test,v_paid_price,v_paid_amount
  from public.tests_catalog tc
  join public.test_prices tp on tp.tenant_id=tc.tenant_id and tp.test_id=tc.id and tp.is_current
    and (tp.branch_id=v_branch or tp.branch_id is null)
  where tc.tenant_id=v_tenant and tc.code='HEM_CBC' and tc.is_active
  order by (tp.branch_id is not null) desc limit 1;
  if v_paid_test is null or v_paid_price is null or v_paid_amount<75 then
    raise exception 'TEST BLOCKED: a current nonzero CBC price of at least 75 is required for payment idempotency';
  end if;
  select work_date,id into v_work_date,v_workday
  from public.branch_workdays where tenant_id=v_tenant and branch_id=v_branch and status='open'
  order by work_date desc limit 1;
  if v_workday is null then
    raise exception 'TEST BLOCKED: no already-open Test1 workday; no persistent workday will be created';
  end if;

  insert into public.staff_directory(id,tenant_id,branch_id,display_name,is_active,auth_user_id)
  values(v_staff,v_tenant,v_branch,'Cycle2 SQL Test '||substr(v_staff::text,1,8),true,v_user);
  perform public.open_branch_workday(v_tenant,v_branch,v_work_date,v_staff);
  insert into public.patients(id,tenant_id,branch_id,patient_number,full_name,sex,age_value,age_unit,created_by,created_by_staff_id)
  values(v_patient,v_tenant,v_branch,'CYCLE2-'||upper(substr(v_patient::text,1,8)),
    'Cycle Two Offline Sync Test','unknown',35,'years',v_user,v_staff);

  v_visit := public.create_visit_intake_idempotent(
    v_visit_op,v_tenant,v_branch,v_patient,'CYCLE2-'||upper(substr(v_visit_op::text,1,8)),
    v_staff,array[v_test],0,0,'cash',null,'transactional offline integration test',
    jsonb_build_array(jsonb_build_object('test_id',v_test,'price_id',v_price,'selling_price',0))
  );
  v_visit_retry := public.create_visit_intake_idempotent(
    v_visit_op,v_tenant,v_branch,v_patient,'CYCLE2-'||upper(substr(v_visit_op::text,1,8)),
    v_staff,array[v_test],0,0,'cash',null,'transactional offline integration test',
    jsonb_build_array(jsonb_build_object('test_id',v_test,'price_id',v_price,'selling_price',0))
  );
  if v_visit<>v_visit_retry then raise exception 'TEST FAIL: repeated intake did not return the same visit'; end if;
  begin
    perform public.create_visit_intake_idempotent(
      gen_random_uuid(),v_tenant,v_branch,v_patient,'CYCLE2-STALE-'||substr(gen_random_uuid()::text,1,8),
      v_staff,array[v_test],0,0,'cash',null,'stale offline price conflict test',
      jsonb_build_array(jsonb_build_object('test_id',v_test,'price_id',v_price,'selling_price',1))
    );
    raise exception 'TEST FAIL: stale offline price snapshot was accepted';
  exception when others then
    if position('OFFLINE_PRICE_CONFLICT' in sqlerrm)=0 then raise; end if;
    v_price_conflict_rejected := true;
  end;
  select count(*) into v_count from public.visits where id=v_visit and tenant_id=v_tenant and branch_id=v_branch;
  if v_count<>1 then raise exception 'TEST FAIL: visit intake was duplicated'; end if;
  select id into v_visit_test from public.visit_tests where visit_id=v_visit and tenant_id=v_tenant and branch_id=v_branch;
  if v_visit_test is null then raise exception 'TEST FAIL: visit test was not created'; end if;

  v_paid_visit:=public.create_visit_intake_idempotent(
    v_paid_visit_op,v_tenant,v_branch,v_patient,'CYCLE2-PAID-'||substr(v_paid_visit_op::text,1,8),
    v_staff,array[v_paid_test],0,50,'cash',null,'transactional payment idempotency test',
    jsonb_build_array(jsonb_build_object('test_id',v_paid_test,'price_id',v_paid_price,'selling_price',v_paid_amount))
  );
  v_payment_id:=public.record_patient_payment(v_tenant,v_paid_visit,25,'cash',v_payment_op,v_staff,'Cycle2 payment retry test');
  v_payment_retry:=public.record_patient_payment(v_tenant,v_paid_visit,25,'cash',v_payment_op,v_staff,'Cycle2 payment retry test');
  if v_payment_id is null or v_payment_id is distinct from v_payment_retry then
    raise exception 'TEST FAIL: repeated payment sync did not return the same payment ID';
  end if;
  select count(*) into v_payment_count from public.payments where tenant_id=v_tenant and idempotency_key=v_payment_op;
  if v_payment_count<>1 then raise exception 'TEST FAIL: payment retry duplicated the payment row'; end if;

  select array_agg(id order by id) into v_ids
  from public.save_draft_results_idempotent(v_results_op,v_tenant,v_branch,v_visit_test,v_staff,v_results);
  select array_agg(id order by id) into v_retry_ids
  from public.save_draft_results_idempotent(v_results_op,v_tenant,v_branch,v_visit_test,v_staff,v_results);
  if v_ids is null or cardinality(v_ids)<2 or v_ids is distinct from v_retry_ids then
    raise exception 'TEST FAIL: repeated result sync did not return the same result IDs';
  end if;
  select count(*) into v_count from public.test_results where tenant_id=v_tenant and visit_test_id=v_visit_test;
  if v_count<2 then raise exception 'TEST FAIL: expected result values were not persisted'; end if;
  begin
    perform * from public.save_draft_results_idempotent(v_results_op,v_tenant,v_branch,v_visit_test,v_staff,
      jsonb_build_array(jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',101,'value_text',null,'flag','normal')));
    raise exception 'TEST FAIL: idempotency key accepted a changed payload';
  exception when others then
    if position('Idempotency key reused with different payload' in sqlerrm)=0 then raise; end if;
  end;

  perform public.complete_visit_test_atomic(v_tenant,v_branch,v_visit_test,v_staff);
  perform public.approve_visit_with_auto_completion(v_tenant,v_branch,v_visit,v_staff);
  update public.site_settings
    set portal_settings=jsonb_set(coalesce(portal_settings,'{}'::jsonb),'{enabled}','true'::jsonb,true)
    where tenant_id=v_tenant;
  if not found then raise exception 'TEST BLOCKED: Test1 site_settings row is missing'; end if;
  v_report_path:=v_tenant::text||'/'||v_visit::text||'/'||gen_random_uuid()::text||'.pdf';
  select id into v_report_id from public.publish_report_version(v_tenant,v_branch,v_visit,v_report_path,null,v_staff);
  if v_report_id is null then raise exception 'TEST FAIL: final report metadata was not published'; end if;
  if not exists(select 1 from public.report_versions where id=v_report_id and visit_id=v_visit and is_published) then
    raise exception 'TEST FAIL: published report version is not visible';
  end if;
  if not exists(select 1 from public.visits where id=v_visit and status='published' and is_published) then
    raise exception 'TEST FAIL: visit did not reach published status';
  end if;

  insert into pg_temp.cycle2_test_output(details) values(jsonb_build_object(
    'status','PASS','tenant_id',v_tenant,'branch_id',v_branch,'visit_id',v_visit,
    'visit_test_id',v_visit_test,'report_version_id',v_report_id,
    'zero_price_accepted',true,'stale_price_conflict_rejected',v_price_conflict_rejected,'payment_idempotent_replay',v_payment_id=v_payment_retry,'payment_rows',v_payment_count,'visit_idempotent_replay',true,
    'result_idempotent_replay',true,'changed_payload_rejected',true,
    'persisted_result_rows',v_count,'report_published',true,
    'transaction_rolled_back',true
  ));
end
$cycle$;
select details from cycle2_test_output;
rollback;
