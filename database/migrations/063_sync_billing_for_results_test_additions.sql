-- Keep reception billing in sync when a forgotten test is added from the results screen.
create or replace function private.sync_visit_billing_for_added_test(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_has_billing boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  perform 1 from public.visits v where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=p_visit_id for update;
  if not found then raise exception 'Visit not found for billing update'; end if;

  select coalesce(sum(vt.price_snapshot),0)::numeric(14,2) into v_gross
    from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.visit_id=p_visit_id and vt.status<>'cancelled';
  select vb.discount_amount into v_discount
    from public.visit_billing vb where vb.visit_id=p_visit_id and vb.tenant_id=p_tenant_id and vb.branch_id=p_branch_id
    for update;
  v_has_billing := found;
  if v_has_billing then
    if coalesce(v_discount,0)>v_gross then raise exception 'Existing visit discount exceeds the updated gross total'; end if;
    update public.visit_billing set gross_total=v_gross
     where visit_id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  else
    insert into public.visit_billing(tenant_id,branch_id,visit_id,gross_total,discount_amount,created_by)
    values(p_tenant_id,p_branch_id,p_visit_id,v_gross,0,auth.uid());
  end if;
end;
$function$;
revoke all on function private.sync_visit_billing_for_added_test(uuid,uuid,uuid) from public,anon;
grant execute on function private.sync_visit_billing_for_added_test(uuid,uuid,uuid) to authenticated;

create or replace function public.add_test_to_visit_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_test_id uuid,
  p_staff_id uuid
) returns public.visit_tests
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits;
  v_existing public.visit_tests;
  v_test public.tests_catalog;
  v_result public.visit_tests;
  v_account_type text;
  v_expected_staff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  select tm.account_type into v_account_type from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id
       and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then
      raise exception 'Employee accounts may only act as their own linked staff identity';
    end if;
  elsif v_account_type<>'owner' then
    raise exception 'Owner or branch employee access required';
  end if;

  select * into v_visit from public.visits
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id
   for update;
  if not found then raise exception 'Visit not found for this tenant and branch'; end if;
  if v_visit.status in ('approved','published','cancelled') or v_visit.is_published then
    raise exception 'A finalized visit cannot receive additional tests';
  end if;
  select * into v_test from public.tests_catalog
   where tenant_id=p_tenant_id and id=p_test_id and is_active;
  if not found then raise exception 'Active catalog test not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_branch_id::text || ':' || p_visit_id::text || ':' || p_test_id::text, 0
  ));
  select * into v_existing from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and visit_id=p_visit_id and test_id=p_test_id and status<>'cancelled'
   order by created_at limit 1;
  if found then
    perform private.sync_visit_billing_for_added_test(p_tenant_id,p_branch_id,p_visit_id);
    return v_existing;
  end if;

  insert into public.visit_tests(tenant_id,branch_id,visit_id,test_id,created_by,created_by_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_id,p_test_id,auth.uid(),p_staff_id)
  returning * into v_result;
  perform private.sync_visit_billing_for_added_test(p_tenant_id,p_branch_id,p_visit_id);
  return v_result;
end;
$function$;
revoke all on function public.add_test_to_visit_atomic(uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.add_test_to_visit_atomic(uuid,uuid,uuid,uuid,uuid) to authenticated;
