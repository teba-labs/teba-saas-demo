-- Idempotent add-test-to-existing-visit operation for the results workbench.
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
  select tm.account_type into v_account_type
    from public.tenant_memberships tm
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
  if found then return v_existing; end if;

  insert into public.visit_tests(tenant_id,branch_id,visit_id,test_id,created_by,created_by_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_id,p_test_id,auth.uid(),p_staff_id)
  returning * into v_result;
  return v_result;
end;
$function$;

revoke all on function public.add_test_to_visit_atomic(uuid,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.add_test_to_visit_atomic(uuid,uuid,uuid,uuid,uuid) to authenticated;
