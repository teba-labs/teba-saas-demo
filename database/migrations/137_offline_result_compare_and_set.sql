-- 137: Compare-and-set draft result writes; preserve every existing result row.
-- Existing legacy clients fail closed when they try to overwrite a result.
-- No data rewrite, delete, or backfill is performed by this migration.

create or replace function public.save_draft_results_idempotent_v2(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid,
  p_results jsonb,
  p_expected_snapshot jsonb
) returns setof public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_receipt private.offline_operation_receipts%rowtype;
  v_payload jsonb;
  v_result_ids uuid[];
  v_expected record;
  v_current public.test_results%rowtype;
  v_actual jsonb;
  v_submitted_count integer;
  v_expected_count integer;
  v_visit_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch access denied' using errcode='42501';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if not private.is_tenant_owner(p_tenant_id) and not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active and sd.auth_user_id=auth.uid()
  ) then
    raise exception 'Employee accounts may only act as their own linked active staff identity' using errcode='42501';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Results must be a JSON array';
  end if;
  if jsonb_array_length(p_results) not between 1 and 100 then
    raise exception 'Results must contain 1 to 100 values';
  end if;
  if jsonb_typeof(p_expected_snapshot) is distinct from 'array' then
    raise exception 'Expected result snapshot must be a JSON array';
  end if;

  select count(*),count(distinct x.parameter_code)
    into v_submitted_count,v_expected_count
    from jsonb_to_recordset(p_results) as x(parameter_code text);
  if v_submitted_count<>v_expected_count or v_submitted_count<>jsonb_array_length(p_expected_snapshot) then
    raise exception 'Expected result snapshot does not match submitted parameters';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_expected_snapshot) as e(parameter_code text)
    where not exists (
      select 1 from jsonb_to_recordset(p_results) as r(parameter_code text)
      where r.parameter_code=e.parameter_code
    )
  ) or exists (
    select 1 from jsonb_to_recordset(p_results) as r(parameter_code text)
    where not exists (
      select 1 from jsonb_to_recordset(p_expected_snapshot) as e(parameter_code text)
      where e.parameter_code=r.parameter_code
    )
  ) then
    raise exception 'Expected result snapshot does not match submitted parameters';
  end if;

  v_payload := jsonb_build_object(
    'visit_test_id',p_visit_test_id,
    'staff_id',p_staff_id,
    'results',p_results,
    'expected_snapshot',p_expected_snapshot
  );
  insert into private.offline_operation_receipts
    (tenant_id,branch_id,operation_id,created_by,payload)
  values (p_tenant_id,p_branch_id,p_operation_id,auth.uid(),v_payload)
  on conflict (tenant_id,branch_id,operation_id) do nothing;

  select * into v_receipt from private.offline_operation_receipts
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id
   for update;
  if not found then raise exception 'Offline operation receipt could not be locked'; end if;
  if v_receipt.created_by is distinct from auth.uid() then
    raise exception 'Offline operation belongs to another user' using errcode='42501';
  end if;
  if v_receipt.payload is distinct from v_payload then
    raise exception 'Idempotency key reused with different payload';
  end if;
  if cardinality(v_receipt.result_ids)>0 then
    return query select tr.* from public.test_results tr
     where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
       and tr.id=any(v_receipt.result_ids) order by tr.entered_at,tr.id;
    return;
  end if;

  -- Lock the same workflow rows as the underlying atomic save before comparing.
  select v.status into v_visit_status
    from public.visit_tests vt
    join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id
     and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v,vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;

  for v_expected in
    select * from jsonb_to_recordset(p_expected_snapshot) as e(
      parameter_code text,value_numeric numeric,value_text text,flag text
    )
  loop
    select * into v_current from public.test_results
     where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id
       and parameter_code=v_expected.parameter_code for update;
    if found then
      v_actual:=jsonb_build_object(
        'parameter_code',v_expected.parameter_code,
        'value_numeric',v_current.value_numeric,
        'value_text',v_current.value_text,
        'flag',v_current.flag
      );
    else
      v_actual:=jsonb_build_object(
        'parameter_code',v_expected.parameter_code,
        'value_numeric',null,
        'value_text',null,
        'flag',null
      );
    end if;
    if v_actual is distinct from jsonb_build_object(
      'parameter_code',v_expected.parameter_code,
      'value_numeric',v_expected.value_numeric,
      'value_text',v_expected.value_text,
      'flag',v_expected.flag
    ) then
      raise exception 'OFFLINE_RESULTS_CONFLICT: a submitted result changed on another device'
        using errcode='40001';
    end if;
  end loop;

  perform set_config('app.result_write_authorized','on',true);
  select coalesce(array_agg(saved.id),'{}'::uuid[]) into v_result_ids
    from public.save_draft_results_atomic(
      p_tenant_id,p_branch_id,p_visit_test_id,p_staff_id,p_results
    ) saved;
  perform set_config('app.result_write_authorized','off',true);
  if cardinality(v_result_ids)=0 then raise exception 'Draft result save returned no acknowledged rows'; end if;

  update private.offline_operation_receipts
     set result_ids=v_result_ids,completed_at=now()
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id;

  return query select tr.* from public.test_results tr
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
     and tr.id=any(v_result_ids) order by tr.entered_at,tr.id;
end;
$function$;

-- Keep the old RPC callable for older clients, but make it insert-only:
-- any attempt to overwrite an existing parameter is rejected as a conflict.
create or replace function public.save_draft_results_idempotent(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid,
  p_results jsonb
) returns setof public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_receipt private.offline_operation_receipts%rowtype;
  v_payload jsonb;
  v_result_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch access denied' using errcode='42501';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if not private.is_tenant_owner(p_tenant_id) and not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active and sd.auth_user_id=auth.uid()
  ) then
    raise exception 'Employee accounts may only act as their own linked active staff identity' using errcode='42501';
  end if;
  v_payload:=jsonb_build_object('visit_test_id',p_visit_test_id,'staff_id',p_staff_id,'results',p_results);
  insert into private.offline_operation_receipts(tenant_id,branch_id,operation_id,created_by,payload)
  values(p_tenant_id,p_branch_id,p_operation_id,auth.uid(),v_payload)
  on conflict(tenant_id,branch_id,operation_id) do nothing;
  select * into v_receipt from private.offline_operation_receipts
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id for update;
  if not found then raise exception 'Offline operation receipt could not be locked'; end if;
  if v_receipt.created_by is distinct from auth.uid() then raise exception 'Offline operation belongs to another user' using errcode='42501'; end if;
  if v_receipt.payload is distinct from v_payload then raise exception 'Idempotency key reused with different payload'; end if;
  if cardinality(v_receipt.result_ids)>0 then
    return query select tr.* from public.test_results tr where tr.tenant_id=p_tenant_id
      and tr.visit_test_id=p_visit_test_id and tr.id=any(v_receipt.result_ids) order by tr.entered_at,tr.id;
    return;
  end if;
  perform 1 from public.visit_tests vt
    join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id
     and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v,vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_results) as x(parameter_code text)
    join public.test_results tr on tr.tenant_id=p_tenant_id
      and tr.visit_test_id=p_visit_test_id and tr.parameter_code=x.parameter_code
  ) then
    raise exception 'OFFLINE_RESULTS_CONFLICT: legacy result save cannot overwrite an existing value'
      using errcode='40001';
  end if;
  perform set_config('app.result_write_authorized','on',true);
  select coalesce(array_agg(saved.id),'{}'::uuid[]) into v_result_ids
    from public.save_draft_results_atomic(p_tenant_id,p_branch_id,p_visit_test_id,p_staff_id,p_results) saved;
  perform set_config('app.result_write_authorized','off',true);
  if cardinality(v_result_ids)=0 then raise exception 'Draft result save returned no acknowledged rows'; end if;
  update private.offline_operation_receipts set result_ids=v_result_ids,completed_at=now()
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id;
  return query select tr.* from public.test_results tr where tr.tenant_id=p_tenant_id
    and tr.visit_test_id=p_visit_test_id and tr.id=any(v_result_ids) order by tr.entered_at,tr.id;
end;
$function$;

revoke all on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

comment on function public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) is
  'Idempotent compare-and-set draft result save. Compares each submitted parameter to its caller-observed base value under the visit lock and rejects stale writes without modifying results.';

-- A table-level RLS policy currently permits authenticated users to UPDATE/DELETE test_results.
-- This trigger closes direct PostgREST/table-write paths. Only protected saves and audited
-- correction workflows set the transaction-local gates; trusted SECURITY DEFINER workflows
-- retain their existing ability to clean hidden values and permanently remove visits.
create or replace function private.guard_test_result_mutation_compare_and_set()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $guard$
begin
  if current_user='authenticated'
     and current_setting('app.result_write_authorized',true) is distinct from 'on'
     and current_setting('app.result_correction',true) is distinct from 'on' then
    raise exception 'OFFLINE_RESULTS_CONFLICT: direct result mutations are blocked; use the protected save or correction workflow'
      using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$guard$;

drop trigger if exists trg_guard_test_result_update_compare_and_set on public.test_results;
drop trigger if exists trg_guard_test_result_mutation_compare_and_set on public.test_results;
create trigger trg_guard_test_result_mutation_compare_and_set
before update or delete on public.test_results
for each row execute function private.guard_test_result_mutation_compare_and_set();
revoke all on function private.guard_test_result_mutation_compare_and_set() from public,anon,authenticated;

-- Preserve the existing controlled correction route for completed, unpublished tests.
create or replace function public.correct_completed_visit_result(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_result_id uuid,
  p_value_numeric numeric,p_value_text text,p_reason text,p_staff_id uuid
) returns public.test_results
language plpgsql
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
  select tm.account_type into v_account_type from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then
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
  if not found or v_visit.is_published or v_visit.status in ('approved','published','cancelled') then
    raise exception 'This visit must use the published correction workflow or be reopened by an owner';
  end if;

  select * into v_result from public.test_results
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and id=p_result_id for update;
  if not found then raise exception 'Result not found for this completed test'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then raise exception 'Provide exactly one numeric or text result value'; end if;

  perform set_config('app.result_correction','on',true);
  update public.test_results set
    value_numeric=p_value_numeric,value_text=p_value_text,correction_reason=null,
    entered_by=auth.uid(),entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and id=p_result_id
   returning * into v_updated;
  perform set_config('app.result_correction','off',true);
  return v_updated;
end;
$function$;

-- Approved-unpublished owner corrections remain authorized by the existing role checks.
create or replace function public.correct_visit_result_with_flag(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_result_id uuid,
  p_value_numeric numeric,p_value_text text,p_flag text,p_reason text,p_staff_id uuid
) returns public.test_results
language plpgsql
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
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then
    raise exception 'An active staff identity for this branch is required';
  end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee accounts may only act as their own linked active staff identity'; end if;
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required'; end if;

  select * into v_test from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_test_id for update;
  if not found or v_test.status<>'completed' then raise exception 'Only a completed visit test can use this correction workflow'; end if;
  select * into v_visit from public.visits
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot be corrected'; end if;
  if v_visit.status='approved' and not v_visit.is_published and v_account_type<>'owner' then
    raise exception 'An approved unpublished visit can only be corrected by the tenant owner';
  end if;
  select * into v_result from public.test_results
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and id=p_result_id for update;
  if not found then raise exception 'Result not found for this completed test'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then raise exception 'Provide exactly one numeric or text result value'; end if;
  if p_value_text is not null and p_flag is not null then raise exception 'Text results cannot carry a numeric reference-range flag'; end if;

  perform set_config('app.result_correction','on',true);
  update public.test_results set
    value_numeric=p_value_numeric,value_text=p_value_text,flag=p_flag,correction_reason=null,
    entered_by=auth.uid(),entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and id=p_result_id
   returning * into v_updated;
  perform set_config('app.result_correction','off',true);
  return v_updated;
end;
$function$;

-- Updating flags after a reference-range override is an audited correction operation.
create or replace function public.set_visit_parameter_range_override(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_parameter_code text,
  p_reference_ranges jsonb,p_staff_id uuid,p_reason text
) returns public.visit_test_parameter_range_overrides
language plpgsql
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
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required'; end if;
  select vt.* into v_test from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.id=p_visit_test_id for update;
  if not found then raise exception 'Visit test not found for this tenant and branch'; end if;
  if v_test.status='cancelled' then raise exception 'Cancelled tests cannot have their reference ranges changed'; end if;
  select v.* into v_visit from public.visits v
   where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot have their reference ranges changed'; end if;
  if v_visit.status='approved' and not v_visit.is_published and v_account_type<>'owner' then
    raise exception 'Only the lab owner may correct an approved unpublished visit';
  end if;
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

  perform set_config('app.result_correction','on',true);
  update public.test_results set flag=null,correction_reason=null,entered_by=auth.uid(),
    entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
  perform set_config('app.result_correction','off',true);
  return v_result;
end;
$function$;


-- Retain the legacy published-correction RPC only for tenant owners.
-- Older clients may still call this name; employees must use the controlled workflow.
create or replace function public.correct_published_result(
  p_tenant_id uuid,p_branch_id uuid,p_visit_id uuid,p_result_id uuid,
  p_value_numeric numeric,p_value_text text,p_reason text,p_staff_id uuid
) returns public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_result public.test_results%rowtype;
  v_visit public.visits%rowtype;
  v_updated public.test_results%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the lab owner may correct published results'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  select * into v_visit from public.visits
    where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
  if not found or not v_visit.is_published then raise exception 'Only a published visit can use this correction workflow'; end if;
  select tr.* into v_result from public.test_results tr
    join public.visit_tests vt on vt.id=tr.visit_test_id and vt.tenant_id=tr.tenant_id
    where tr.id=p_result_id and tr.tenant_id=p_tenant_id and vt.visit_id=p_visit_id and vt.branch_id=p_branch_id
    for update of tr;
  if not found then raise exception 'Result not found'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then
    raise exception 'Provide exactly one numeric or text result value';
  end if;
  perform set_config('app.result_correction','on',true);
  update public.test_results set
    value_numeric=p_value_numeric,value_text=p_value_text,correction_reason=null,
    entered_by=auth.uid(),entered_by_staff_id=p_staff_id,updated_at=now()
  where id=p_result_id and tenant_id=p_tenant_id returning * into v_updated;
  perform set_config('app.result_correction','off',true);
  return v_updated;
end;
$function$;
