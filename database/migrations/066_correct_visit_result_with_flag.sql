-- One correction RPC for both completed unpublished results and already-published results.
-- A published PDF remains immutable; the next publish action creates a corrected version.
create or replace function public.correct_visit_result_with_flag(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_result_id uuid,
  p_value_numeric numeric,
  p_value_text text,
  p_flag text,
  p_reason text,
  p_staff_id uuid
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
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Correction reason is required'; end if;
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
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required';
  end if;

  select * into v_test from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_test_id for update;
  if not found or v_test.status<>'completed' then raise exception 'Only a completed visit test can use this correction workflow'; end if;
  select * into v_visit from public.visits
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=v_test.visit_id for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot be corrected'; end if;
  if v_visit.status='approved' and not v_visit.is_published then
    raise exception 'An approved but unpublished visit must be reopened by an owner before correction';
  end if;

  select * into v_result from public.test_results
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and id=p_result_id for update;
  if not found then raise exception 'Result not found for this completed test'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then raise exception 'Provide exactly one numeric or text result value'; end if;
  if p_value_text is not null and p_flag is not null then raise exception 'Text results cannot carry a numeric reference-range flag'; end if;

  if v_visit.is_published then perform set_config('app.result_correction','on',true); end if;
  update public.test_results set
    value_numeric=p_value_numeric,value_text=p_value_text,flag=p_flag,correction_reason=btrim(p_reason),
    entered_by=auth.uid(),entered_by_staff_id=p_staff_id,updated_at=now()
   where tenant_id=p_tenant_id and id=p_result_id
   returning * into v_updated;
  return v_updated;
end;
$function$;
revoke all on function public.correct_visit_result_with_flag(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid) from public,anon;
grant execute on function public.correct_visit_result_with_flag(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid) to authenticated;
