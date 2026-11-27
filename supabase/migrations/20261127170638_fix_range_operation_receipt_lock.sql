-- Correct the idempotent range receipt lookup: authenticated can SELECT/INSERT only.
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
  -- Serialize retries by operation ID; this avoids requiring UPDATE privilege on the receipt table.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.visit_range_override_operations where operation_id=p_operation_id;
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
