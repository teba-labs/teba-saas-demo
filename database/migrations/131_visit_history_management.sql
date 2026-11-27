begin;

-- Corrections no longer require a free-text reason. The actor, timestamp,
-- old/new row values and visit-only scope remain captured by audit triggers.
alter table public.visit_test_parameter_range_overrides alter column reason drop not null;
alter table public.visit_test_parameter_range_overrides drop constraint if exists visit_test_parameter_range_overrides_reason_check;
alter table public.visit_test_parameter_range_events alter column reason drop not null;

create or replace function public.correct_visit_result_with_flag(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_result_id uuid,
  p_value_numeric numeric,p_value_text text,p_flag text,p_reason text,p_staff_id uuid
) returns public.test_results
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_test public.visit_tests;
  v_visit public.visits;
  v_result public.test_results;
  v_updated public.test_results;
  v_account_type text;
  v_expected_staff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if p_flag is not null and p_flag not in ('low','high','normal','critical_low','critical_high') then raise exception 'Unsupported result flag'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then
    raise exception 'An active staff identity for this branch is required';
  end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee accounts may only act as their own linked active staff identity'; end if;
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required';
  end if;
  select * into v_test from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_test_id for update;
  if not found or v_test.status<>'completed' then raise exception 'Only a completed visit test can use this correction workflow'; end if;
  select * into v_visit from public.visits
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot be corrected'; end if;
  -- Both owner and branch employee may correct an approved, unpublished visit.
  select * into v_result from public.test_results
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and id=p_result_id for update;
  if not found then raise exception 'Result not found for this completed test'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then raise exception 'Provide exactly one numeric or text result value'; end if;
  if p_value_text is not null and p_flag is not null then raise exception 'Text results cannot carry a numeric reference-range flag'; end if;
  if v_visit.is_published then perform set_config('app.result_correction','on',true); end if;
  update public.test_results set
    value_numeric=p_value_numeric,value_text=p_value_text,flag=p_flag,correction_reason=null,
    entered_by=auth.uid(),entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and id=p_result_id returning * into v_updated;
  return v_updated;
end;
$function$;
revoke all on function public.correct_visit_result_with_flag(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid) from public,anon;
grant execute on function public.correct_visit_result_with_flag(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid) to authenticated;

create or replace function public.set_visit_parameter_range_override(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_parameter_code text,
  p_reference_ranges jsonb,p_staff_id uuid,p_reason text
) returns public.visit_test_parameter_range_overrides
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits;
  v_test public.visit_tests;
  v_parameter jsonb;
  v_old jsonb;
  v_result public.visit_test_parameter_range_overrides;
  v_account_type text;
  v_expected_staff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if jsonb_typeof(p_reference_ranges) not in ('array','object') or p_reference_ranges='[]'::jsonb then
    raise exception 'A non-empty reference interval is required';
  end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then
    raise exception 'An active staff identity for this branch is required';
  end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee accounts may only act as their own linked active staff identity'; end if;
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required';
  end if;
  select vt.* into v_test from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.id=p_visit_test_id for update;
  if not found then raise exception 'Visit test not found for this tenant and branch'; end if;
  if v_test.status='cancelled' then raise exception 'Cancelled tests cannot have their reference ranges changed'; end if;
  select v.* into v_visit from public.visits v
   where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot have their reference ranges changed'; end if;
  select p into v_parameter from jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters','[]'::jsonb)) p
   where p->>'code'=p_parameter_code limit 1;
  if v_parameter is null then raise exception 'Parameter is not part of this visit test snapshot'; end if;
  select o.reference_ranges into v_old from public.visit_test_parameter_range_overrides o
   where o.tenant_id=p_tenant_id and o.visit_test_id=p_visit_test_id and o.parameter_code=p_parameter_code;
  if v_old is null then v_old:=coalesce(v_parameter->'reference_ranges','[]'::jsonb); end if;
  insert into public.visit_test_parameter_range_overrides
    (tenant_id,branch_id,visit_test_id,parameter_code,reference_ranges,reason,updated_by,updated_by_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,p_reference_ranges,null,auth.uid(),p_staff_id)
  on conflict(tenant_id,visit_test_id,parameter_code) do update set
    reference_ranges=excluded.reference_ranges,reason=null,
    updated_by=excluded.updated_by,updated_by_staff_id=excluded.updated_by_staff_id,updated_at=now()
  returning * into v_result;
  insert into public.visit_test_parameter_range_events
    (tenant_id,branch_id,visit_test_id,parameter_code,old_reference_ranges,new_reference_ranges,reason,actor_user_id,actor_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,v_old,p_reference_ranges,null,auth.uid(),p_staff_id);
  if v_visit.is_published then perform set_config('app.result_correction','on',true); end if;
  update public.test_results set flag=null,correction_reason=null,entered_by=auth.uid(),
    entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
  return v_result;
end;
$function$;
revoke all on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) from public,anon;
grant execute on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) to authenticated;

-- Idempotent wrapper so an offline range edit is not recorded twice on retry.
create table if not exists public.visit_range_override_operations (
  operation_id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_test_id uuid not null,
  parameter_code text not null,
  payload jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete restrict
);
alter table public.visit_range_override_operations enable row level security;
grant select,insert on public.visit_range_override_operations to authenticated;
drop policy if exists visit_range_operation_read on public.visit_range_override_operations;
create policy visit_range_operation_read on public.visit_range_override_operations for select to authenticated
using (private.can_access_branch(tenant_id,branch_id));
drop policy if exists visit_range_operation_insert on public.visit_range_override_operations;
create policy visit_range_operation_insert on public.visit_range_override_operations for insert to authenticated
with check (private.can_access_branch(tenant_id,branch_id) and actor_user_id=(select auth.uid()));
create or replace function public.set_visit_parameter_range_override_idempotent(
  p_operation_id uuid,p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,
  p_parameter_code text,p_reference_ranges jsonb,p_staff_id uuid
) returns public.visit_test_parameter_range_overrides
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_existing public.visit_range_override_operations;
  v_result public.visit_test_parameter_range_overrides;
  v_payload jsonb;
begin
  if p_operation_id is null then raise exception 'An operation ID is required'; end if;
  v_payload=jsonb_build_object('visit_test_id',p_visit_test_id,'parameter_code',p_parameter_code,'reference_ranges',p_reference_ranges);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.visit_range_override_operations where operation_id=p_operation_id for update;
  if found then
    if v_existing.tenant_id<>p_tenant_id or v_existing.branch_id<>p_branch_id or v_existing.actor_user_id<>auth.uid() or v_existing.payload<>v_payload then
      raise exception 'Offline operation ID was reused with different range data';
    end if;
    select * into v_result from public.visit_test_parameter_range_overrides
     where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
    if not found then raise exception 'Previously synchronized range edit is missing'; end if;
    return v_result;
  end if;
  v_result=public.set_visit_parameter_range_override(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,p_reference_ranges,p_staff_id,null);
  insert into public.visit_range_override_operations(operation_id,tenant_id,branch_id,visit_test_id,parameter_code,payload,actor_user_id)
  values(p_operation_id,p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,v_payload,auth.uid());
  return v_result;
end;
$function$;
revoke all on function public.set_visit_parameter_range_override_idempotent(uuid,uuid,uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.set_visit_parameter_range_override_idempotent(uuid,uuid,uuid,uuid,text,jsonb,uuid) to authenticated;

create or replace function public.update_patient_demographics(
  p_tenant_id uuid,p_branch_id uuid,p_patient_id uuid,p_staff_id uuid,
  p_full_name text,p_phone text,p_sex text,p_date_of_birth date,p_age_value numeric,p_age_unit text,
  p_expected_updated_at timestamptz default null
) returns public.patients
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_account_type text;
  v_expected_staff uuid;
  v_patient public.patients;
  v_unit text:=coalesce(nullif(p_age_unit,''),'years');
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Authentication or branch access denied'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type not in ('owner','employee') then raise exception 'Owner or branch employee access required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Active staff identity required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee may only act as their own active branch identity'; end if;
  end if;
  if nullif(btrim(coalesce(p_full_name,'')),'') is null then raise exception 'اسم المريض مطلوب'; end if;
  if length(btrim(p_full_name))>160 then raise exception 'اسم المريض أطول من الحد المسموح'; end if;
  if p_sex not in ('male','female','other','unknown') then raise exception 'نوع المريض غير صحيح'; end if;
  if v_unit not in ('days','months','years') then raise exception 'وحدة العمر غير صحيحة'; end if;
  if p_age_value is not null and (p_age_value<0 or (v_unit='days' and p_age_value>43800) or (v_unit='months' and p_age_value>1440) or (v_unit='years' and p_age_value>120)) then raise exception 'العمر خارج النطاق المسموح'; end if;
  if p_date_of_birth is not null and p_date_of_birth>current_date then raise exception 'تاريخ الميلاد لا يمكن أن يكون في المستقبل'; end if;
  select * into v_patient from public.patients where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_patient_id for update;
  if not found then raise exception 'Patient not found in this branch'; end if;
  if p_expected_updated_at is not null and v_patient.updated_at<>p_expected_updated_at then raise exception 'بيانات المريض تغيرت على جهاز آخر. حدّث السجل ثم أعد التعديل.'; end if;
  update public.patients set full_name=btrim(p_full_name),phone=nullif(btrim(coalesce(p_phone,'')),''),
    sex=p_sex,date_of_birth=p_date_of_birth,age_value=p_age_value,age_unit=v_unit,
    age_years=case when p_age_value is null then null when v_unit='days' then p_age_value/365.2425 when v_unit='months' then p_age_value/12 else p_age_value end
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_patient_id returning * into v_patient;
  return v_patient;
end;
$function$;
revoke all on function public.update_patient_demographics(uuid,uuid,uuid,uuid,text,text,text,date,numeric,text,timestamptz) from public,anon;
grant execute on function public.update_patient_demographics(uuid,uuid,uuid,uuid,text,text,text,date,numeric,text,timestamptz) to authenticated;

create or replace function public.update_visit_details(
  p_tenant_id uuid,p_branch_id uuid,p_visit_id uuid,p_staff_id uuid,
  p_referred_by text,p_notes text,p_expected_updated_at timestamptz default null
) returns public.visits
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare v_account_type text; v_expected_staff uuid; v_visit public.visits;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Authentication or branch access denied'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type not in ('owner','employee') then raise exception 'Owner or branch employee access required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Active staff identity required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee may only act as their own active branch identity'; end if;
  end if;
  select * into v_visit from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Active visit not found'; end if;
  if p_expected_updated_at is not null and v_visit.updated_at<>p_expected_updated_at then raise exception 'بيانات الزيارة تغيرت على جهاز آخر. حدّث السجل ثم أعد التعديل.'; end if;
  update public.visits set referred_by=nullif(btrim(coalesce(p_referred_by,'')),''),notes=nullif(btrim(coalesce(p_notes,'')),'')
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id returning * into v_visit;
  return v_visit;
end;
$function$;
revoke all on function public.update_visit_details(uuid,uuid,uuid,uuid,text,text,timestamptz) from public,anon;
grant execute on function public.update_visit_details(uuid,uuid,uuid,uuid,text,text,timestamptz) to authenticated;

create or replace function public.cancel_visit_atomic(
  p_tenant_id uuid,p_branch_id uuid,p_visit_id uuid,p_staff_id uuid
) returns public.visits
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare v_account_type text; v_expected_staff uuid; v_visit public.visits;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Authentication or branch access denied'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type not in ('owner','employee') then raise exception 'Owner or branch employee access required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Active staff identity required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee may only act as their own active branch identity'; end if;
  end if;
  select * into v_visit from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if v_visit.status<>'cancelled' then
    update public.visits set status='cancelled' where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id returning * into v_visit;
  end if;
  return v_visit;
end;
$function$;
revoke all on function public.cancel_visit_atomic(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.cancel_visit_atomic(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.cancel_visit_test_atomic(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_staff_id uuid
) returns public.visit_tests
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_account_type text; v_expected_staff uuid; v_test public.visit_tests; v_visit public.visits;
  v_gross numeric(14,2);
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Authentication or branch access denied'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type not in ('owner','employee') then raise exception 'Owner or branch employee access required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Active staff identity required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee may only act as their own active branch identity'; end if;
  end if;
  select * into v_test from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_test_id for update;
  if not found then raise exception 'Visit test not found'; end if;
  select * into v_visit from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Visit is cancelled'; end if;
  if v_test.status<>'cancelled' then update public.visit_tests set status='cancelled' where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_test_id returning * into v_test; end if;
  select coalesce(sum(price_snapshot),0)::numeric(14,2) into v_gross from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=v_visit.id and status<>'cancelled';
  update public.visit_billing set gross_total=v_gross,discount_amount=least(discount_amount,v_gross)
   where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=v_visit.id;
  return v_test;
end;
$function$;
revoke all on function public.cancel_visit_test_atomic(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.cancel_visit_test_atomic(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.delete_visit_permanently(
  p_tenant_id uuid,p_branch_id uuid,p_visit_id uuid,p_staff_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_type text; v_visit public.visits; v_test_ids uuid[]; v_result_ids uuid[];
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Authentication or branch access denied'; end if;
  select tm.account_type into v_type from public.tenant_memberships tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_type<>'owner' then raise exception 'Permanent visit deletion is restricted to the lab owner'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Active staff identity required'; end if;
  select * into v_visit from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if exists(select 1 from public.payments where tenant_id=p_tenant_id and origin_branch_id=p_branch_id and visit_id=p_visit_id)
     or exists(select 1 from public.report_versions where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id)
     or exists(select 1 from public.file_metadata where tenant_id=p_tenant_id and branch_id=p_branch_id and related_visit_id=p_visit_id) then
    raise exception 'لا يمكن حذف هذه الزيارة نهائيًا لأنها مرتبطة بتحصيل مالي أو تقرير محفوظ أو مرفق. استخدم إلغاء الزيارة للاحتفاظ بالسجل بأمان.';
  end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_test_ids from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_result_ids from public.test_results where tenant_id=p_tenant_id and visit_test_id=any(v_test_ids);
  delete from public.visit_test_parameter_range_events where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_test_id=any(v_test_ids);
  delete from public.visit_test_parameter_range_overrides where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_test_id=any(v_test_ids);
  delete from public.test_results where tenant_id=p_tenant_id and visit_test_id=any(v_test_ids);
  delete from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.visit_billing where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.visit_workbench_archive_events where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.audit_logs where tenant_id=p_tenant_id and
    ((table_name='visits' and record_id=p_visit_id::text)
     or (table_name='visit_tests' and record_id=any(select unnest(v_test_ids)::text))
     or (table_name='test_results' and record_id=any(select unnest(v_result_ids)::text)));
  delete from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id;
  insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_staff_id,action,table_name,record_id)
  values(p_tenant_id,p_branch_id,auth.uid(),p_staff_id,'permanently_deleted','visits',p_visit_id::text);
  return jsonb_build_object('deleted',true,'visit_id',p_visit_id);
end;
$function$;
revoke all on function public.delete_visit_permanently(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.delete_visit_permanently(uuid,uuid,uuid,uuid) to authenticated;

commit;
