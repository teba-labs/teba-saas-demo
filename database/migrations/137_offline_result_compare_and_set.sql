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
       and parameter_code=v_expected.parameter_code;
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
        using errcode='40001',detail=v_actual::text;
    end if;
  end loop;

  select coalesce(array_agg(saved.id),'{}'::uuid[]) into v_result_ids
    from public.save_draft_results_atomic(
      p_tenant_id,p_branch_id,p_visit_test_id,p_staff_id,p_results
    ) saved;
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
  if exists(
    select 1 from jsonb_to_recordset(p_results) as x(parameter_code text)
    join public.test_results tr on tr.tenant_id=p_tenant_id
      and tr.visit_test_id=p_visit_test_id and tr.parameter_code=x.parameter_code
  ) then
    raise exception 'OFFLINE_RESULTS_CONFLICT: legacy result save cannot overwrite an existing value'
      using errcode='40001';
  end if;
  select coalesce(array_agg(saved.id),'{}'::uuid[]) into v_result_ids
    from public.save_draft_results_atomic(p_tenant_id,p_branch_id,p_visit_test_id,p_staff_id,p_results) saved;
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
