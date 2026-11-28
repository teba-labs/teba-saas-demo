-- Run only after migration 137 has been separately approved and applied.
-- Test1-only authenticated compare-and-set integration test.
-- Creates a temporary patient/visit/result chain and rolls every row back.
begin;
create temp table cas_test_output(details jsonb) on commit drop;
grant insert,select on cas_test_output to authenticated;
select set_config('request.jwt.claim.sub',(
  select tm.user_id::text from public.tenants t
  join public.tenant_memberships tm on tm.tenant_id=t.id
  where t.slug='test1-lab' and tm.account_type='owner' and tm.is_active
  order by tm.created_at limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $test$
declare
 v_tenant uuid;v_branch uuid;v_user uuid:=auth.uid();v_staff uuid:=gen_random_uuid();v_patient uuid:=gen_random_uuid();
 v_test uuid;v_price uuid;v_visit uuid;v_vt uuid;v_op1 uuid:=gen_random_uuid();v_op2 uuid:=gen_random_uuid();
 v_ids1 uuid[];v_ids2 uuid[];v_replay uuid[];v_conflict boolean:=false;v_legacy boolean:=false;
 v_direct_insert_rejected boolean:=false;v_direct_update_rejected boolean:=false;v_direct_delete_rejected boolean:=false;v_val numeric;v_corrected numeric;v_flag_corrected numeric;v_count integer;v_result_id uuid;
 v_r1 jsonb:=jsonb_build_array(
   jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',100,'value_text',null,'flag','normal'),
   jsonb_build_object('parameter_code','FASTING_INSULIN','value_numeric',10,'value_text',null,'flag','normal'));
 v_r2 jsonb:=jsonb_build_array(
   jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',110,'value_text',null,'flag','normal'),
   jsonb_build_object('parameter_code','FASTING_INSULIN','value_numeric',11,'value_text',null,'flag','normal'));
 v_empty jsonb:=jsonb_build_array(
   jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',null,'value_text',null,'flag',null),
   jsonb_build_object('parameter_code','FASTING_INSULIN','value_numeric',null,'value_text',null,'flag',null));
 v_base jsonb:=jsonb_build_array(
   jsonb_build_object('parameter_code','FASTING_GLUCOSE','value_numeric',100,'value_text',null,'flag','normal'),
   jsonb_build_object('parameter_code','FASTING_INSULIN','value_numeric',10,'value_text',null,'flag','normal'));
begin
 select t.id,b.id into v_tenant,v_branch from public.tenants t
 join public.branches b on b.tenant_id=t.id and b.is_active
 where t.slug='test1-lab' order by b.created_at limit 1;
 if v_tenant is null or v_user is null then raise exception 'TEST BLOCKED: Test1 owner/tenant missing'; end if;
 select tc.id,tp.id into v_test,v_price from public.tests_catalog tc
 join public.test_prices tp on tp.tenant_id=tc.tenant_id and tp.test_id=tc.id and tp.is_current
   and (tp.branch_id=v_branch or tp.branch_id is null)
 where tc.tenant_id=v_tenant and tc.code='HOMA_IR' and tc.is_active and tp.selling_price=0
 order by (tp.branch_id is not null) desc limit 1;
 if v_test is null then raise exception 'TEST BLOCKED: HOMA_IR zero-price test missing'; end if;
 if not exists(select 1 from public.branch_workdays where tenant_id=v_tenant and branch_id=v_branch and status='open') then
   raise exception 'TEST BLOCKED: Test1 has no already-open workday';
 end if;
 insert into public.staff_directory(id,tenant_id,branch_id,display_name,is_active,auth_user_id)
 values(v_staff,v_tenant,v_branch,'CAS Test '||substr(v_staff::text,1,8),true,v_user);
 insert into public.patients(id,tenant_id,branch_id,patient_number,full_name,sex,age_value,age_unit,created_by,created_by_staff_id)
 values(v_patient,v_tenant,v_branch,'CAS-'||upper(substr(v_patient::text,1,8)),
   'CAS Test Patient','unknown',35,'years',v_user,v_staff);
 v_visit:=public.create_visit_intake_idempotent(
   gen_random_uuid(),v_tenant,v_branch,v_patient,'CAS-'||substr(gen_random_uuid()::text,1,8),
   v_staff,array[v_test],0,0,'cash',null,'CAS integration smoke',
   jsonb_build_array(jsonb_build_object('test_id',v_test,'price_id',v_price,'selling_price',0)));
 select id into v_vt from public.visit_tests
  where tenant_id=v_tenant and branch_id=v_branch and visit_id=v_visit;

 select array_agg(id order by id) into v_ids1 from public.save_draft_results_idempotent_v2(
   v_op1,v_tenant,v_branch,v_vt,v_staff,v_r1,v_empty);
 select count(*) into v_count from public.test_results
  where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code in ('FASTING_GLUCOSE','FASTING_INSULIN');
 if v_count<>2 then raise exception 'TEST FAIL: initial manual result insert failed'; end if;

 select array_agg(id order by id) into v_ids2 from public.save_draft_results_idempotent_v2(
   v_op2,v_tenant,v_branch,v_vt,v_staff,v_r2,v_base);
 select array_agg(id order by id) into v_replay from public.save_draft_results_idempotent_v2(
   v_op2,v_tenant,v_branch,v_vt,v_staff,v_r2,v_base);
 if v_ids2 is distinct from v_replay then raise exception 'TEST FAIL: operation replay was not idempotent'; end if;

 begin
   perform * from public.save_draft_results_idempotent_v2(
     gen_random_uuid(),v_tenant,v_branch,v_vt,v_staff,v_r1,v_base);
   raise exception 'TEST FAIL: stale result snapshot was accepted';
 exception when sqlstate '40001' then
   if position('OFFLINE_RESULTS_CONFLICT' in sqlerrm)=0 then raise; end if;
   v_conflict:=true;
 end;
 select value_numeric into v_val from public.test_results
  where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';
 if v_val<>110 then raise exception 'TEST FAIL: newer result was overwritten'; end if;

 begin
   insert into public.test_results(id,tenant_id,visit_test_id,parameter_code,parameter_name_snapshot,
     value_numeric,reference_range_snapshot,entered_by,entered_by_staff_id)
   values(gen_random_uuid(),v_tenant,v_vt,'DIRECT_BYPASS_TEST','Direct bypass test',1,'{}'::jsonb,auth.uid(),v_staff);
   raise exception 'TEST FAIL: direct table INSERT bypassed result protection';
 exception when insufficient_privilege then
   v_direct_insert_rejected:=true;
 end;

 begin
   update public.test_results set value_numeric=99
    where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';
   raise exception 'TEST FAIL: direct table UPDATE bypassed compare-and-set';
 exception when insufficient_privilege then
   v_direct_update_rejected:=true;
 end;
 begin
   delete from public.test_results
    where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';
   raise exception 'TEST FAIL: direct table DELETE bypassed result protection';
 exception when insufficient_privilege then
   v_direct_delete_rejected:=true;
 end;

 begin
   perform * from public.save_draft_results_idempotent(
     gen_random_uuid(),v_tenant,v_branch,v_vt,v_staff,v_r1);
   raise exception 'TEST FAIL: legacy RPC overwrote an existing result';
 exception when sqlstate '40001' then
   if position('OFFLINE_RESULTS_CONFLICT' in sqlerrm)=0 then raise; end if;
   v_legacy:=true;
 end;
 if has_function_privilege('authenticated','public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') then
   raise exception 'TEST FAIL: direct atomic upsert RPC remains executable';
 end if;

 perform public.complete_visit_test_atomic(v_tenant,v_branch,v_vt,v_staff);
 select id into v_result_id from public.test_results
  where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';
 perform public.correct_completed_visit_result(v_tenant,v_branch,v_vt,v_result_id,120,null,null,v_staff);
 perform public.correct_visit_result_with_flag(v_tenant,v_branch,v_vt,v_result_id,130,null,'high',null,v_staff);
 select value_numeric into v_flag_corrected from public.test_results
  where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';
 if v_flag_corrected<>130 or not exists(select 1 from public.test_results
   where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE' and flag='high') then
   raise exception 'TEST FAIL: flagged correction workflow was blocked';
 end if;
 perform public.set_visit_parameter_range_override(
   v_tenant,v_branch,v_vt,'FASTING_GLUCOSE',
   jsonb_build_array(jsonb_build_object('min',70,'max',125,'unit','mg/dL')),
   v_staff,'CAS smoke range correction');
 if exists(select 1 from public.test_results
   where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE' and flag is not null) then
   raise exception 'TEST FAIL: authorized range correction did not clear stale flag';
 end if;
 select value_numeric into v_corrected from public.test_results
  where tenant_id=v_tenant and visit_test_id=v_vt and parameter_code='FASTING_GLUCOSE';

 insert into pg_temp.cas_test_output values(jsonb_build_object(
  'status','PASS','tenant','test1-lab','stale_write_rejected',v_conflict,
  'legacy_overwrite_rejected',v_legacy,'direct_table_insert_rejected',v_direct_insert_rejected,'direct_table_update_rejected',v_direct_update_rejected,'direct_table_delete_rejected',v_direct_delete_rejected,
  'newer_value_preserved_before_correction',v_val,'authorized_completed_result_correction',120,
  'authorized_flagged_correction',v_flag_corrected,'authorized_range_override',v_corrected,
  'same_operation_replay',v_ids2=v_replay,'all_changes_rolled_back',true));
end
$test$;
select details from cas_test_output;
rollback;
