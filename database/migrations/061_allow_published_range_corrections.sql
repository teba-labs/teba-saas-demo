-- Published range corrections update the current result snapshot through the same guarded audit path.
-- The prior PDF remains immutable in report_versions; the next publish creates a corrected version.
create or replace function public.set_visit_parameter_range_override(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_parameter_code text,
  p_reference_ranges jsonb,
  p_staff_id uuid,
  p_reason text
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
  v_reason text := nullif(left(btrim(coalesce(p_reason,'')),500),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if jsonb_typeof(p_reference_ranges) not in ('array','object') or p_reference_ranges='[]'::jsonb then
    raise exception 'A non-empty reference interval is required';
  end if;
  if v_reason is null or length(v_reason)<3 then raise exception 'A correction reason is required'; end if;

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

  select vt.* into v_test from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.id=p_visit_test_id
   for update;
  if not found then raise exception 'Visit test not found for this tenant and branch'; end if;
  if v_test.status='cancelled' then raise exception 'Cancelled tests cannot have their reference ranges changed'; end if;
  select v.* into v_visit from public.visits v
   where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=v_test.visit_id
   for update;
  if not found or v_visit.status='cancelled' then raise exception 'Cancelled visits cannot have their reference ranges changed'; end if;
  if v_visit.status='approved' and not v_visit.is_published then raise exception 'An approved but unpublished visit must be reopened through the approval workflow before changing its reference ranges'; end if;

  select p into v_parameter from jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters','[]'::jsonb)) p
   where p->>'code'=p_parameter_code limit 1;
  if v_parameter is null then raise exception 'Parameter is not part of this visit test snapshot'; end if;

  select o.reference_ranges into v_old from public.visit_test_parameter_range_overrides o
   where o.tenant_id=p_tenant_id and o.visit_test_id=p_visit_test_id and o.parameter_code=p_parameter_code;
  if v_old is null then v_old:=coalesce(v_parameter->'reference_ranges','[]'::jsonb); end if;

  insert into public.visit_test_parameter_range_overrides
    (tenant_id,branch_id,visit_test_id,parameter_code,reference_ranges,reason,updated_by,updated_by_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,p_reference_ranges,v_reason,auth.uid(),p_staff_id)
  on conflict(tenant_id,visit_test_id,parameter_code) do update set
    reference_ranges=excluded.reference_ranges,reason=excluded.reason,
    updated_by=excluded.updated_by,updated_by_staff_id=excluded.updated_by_staff_id,updated_at=now()
  returning * into v_result;

  insert into public.visit_test_parameter_range_events
    (tenant_id,branch_id,visit_test_id,parameter_code,old_reference_ranges,new_reference_ranges,reason,actor_user_id,actor_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,v_old,p_reference_ranges,v_reason,auth.uid(),p_staff_id);

  if v_visit.is_published then
    perform set_config('app.result_correction','on',true);
    update public.test_results set
      correction_reason=v_reason, entered_by=auth.uid(), entered_by_staff_id=p_staff_id, updated_at=now()
     where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
  else
    update public.test_results set updated_at=now()
     where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) from public, anon;
grant execute on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) to authenticated;

