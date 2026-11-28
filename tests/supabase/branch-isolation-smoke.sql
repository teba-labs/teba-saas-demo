-- Transactional branch-isolation test. All test tenant membership, branch, staff and patient rows are rolled back.
begin;
create temp table cycle2_scope_output(details jsonb) on commit drop;
grant insert,select on cycle2_scope_output to authenticated;
select set_config('request.jwt.claim.sub',(
  select tm.user_id::text from public.tenants t
  join public.tenant_memberships tm on tm.tenant_id=t.id
  where t.slug='test1-lab' and tm.account_type='owner' and tm.is_active
  order by tm.created_at limit 1
),true);
select set_config('cycle2.employee_id',(
  select tm.user_id::text from public.tenants other_tenant
  join public.tenant_memberships tm on tm.tenant_id=other_tenant.id
  where other_tenant.slug<>'test1-lab' and tm.is_active
    and not exists(select 1 from public.tenant_memberships own_tm join public.tenants own_tenant on own_tenant.id=own_tm.tenant_id where own_tenant.slug='test1-lab' and own_tm.user_id=tm.user_id)
  order by tm.created_at limit 1
),true);
set local role authenticated;
do $scope$
declare
 v_tenant uuid;
 v_branch_a uuid;
 v_employee uuid := current_setting('cycle2.employee_id')::uuid;
 v_branch_b uuid := gen_random_uuid();
 v_staff_a uuid := gen_random_uuid();
 v_staff_b uuid := gen_random_uuid();
 v_patient_a uuid := gen_random_uuid();
 v_patient_b uuid := gen_random_uuid();
 v_count_a int;
 v_count_b int;
 v_can_a boolean;
 v_can_b boolean;
begin
 select t.id,b.id into v_tenant,v_branch_a
 from public.tenants t join public.branches b on b.tenant_id=t.id and b.is_active
 where t.slug='test1-lab' order by b.created_at limit 1;
 if v_tenant is null or v_branch_a is null or v_employee is null then
   raise exception 'TEST BLOCKED: isolated Test1 tenant or a separate existing employee account is unavailable';
 end if;
 insert into public.branches(id,tenant_id,name,is_active)
 values(v_branch_b,v_tenant,'Cycle2 scope test '||substr(v_branch_b::text,1,8),true);
 insert into public.tenant_memberships(tenant_id,user_id,account_type,is_active)
 values(v_tenant,v_employee,'employee',true);
 insert into public.branch_memberships(tenant_id,branch_id,user_id,is_active)
 values(v_tenant,v_branch_a,v_employee,true);
 insert into public.staff_directory(id,tenant_id,branch_id,display_name,is_active,auth_user_id)
 values(v_staff_a,v_tenant,v_branch_a,'Cycle2 scope A '||substr(v_staff_a::text,1,8),true,v_employee),
       (v_staff_b,v_tenant,v_branch_b,'Cycle2 scope B '||substr(v_staff_b::text,1,8),true,null);
 insert into public.patients(id,tenant_id,branch_id,patient_number,full_name,sex,created_by_staff_id)
 values(v_patient_a,v_tenant,v_branch_a,'C2A-'||substr(v_patient_a::text,1,8),'Cycle2 branch A patient','unknown',v_staff_a),
       (v_patient_b,v_tenant,v_branch_b,'C2B-'||substr(v_patient_b::text,1,8),'Cycle2 branch B patient','unknown',v_staff_b);
 perform set_config('request.jwt.claim.sub',v_employee::text,true);
 v_can_a:=private.can_access_branch(v_tenant,v_branch_a);
 v_can_b:=private.can_access_branch(v_tenant,v_branch_b);
 select count(*) into v_count_a from public.patients where id=v_patient_a;
 select count(*) into v_count_b from public.patients where id=v_patient_b;
 if not v_can_a or v_can_b or v_count_a<>1 or v_count_b<>0 then
   raise exception 'TEST FAIL: branch RLS isolation failed';
 end if;
 insert into pg_temp.cycle2_scope_output(details) values(jsonb_build_object(
  'status','PASS','branch_a_access',v_can_a,'branch_b_access',v_can_b,
  'branch_a_patient_visible',v_count_a=1,'branch_b_patient_hidden',v_count_b=0,
  'transaction_rolled_back',true
 ));
end
$scope$;
select details from cycle2_scope_output;
rollback;
