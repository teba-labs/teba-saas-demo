-- Auth identity binding for operational staff. Candidate only: do not apply to TEST before migration-drift reconciliation.
alter table public.staff_directory
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists staff_directory_tenant_auth_user_uidx
  on public.staff_directory (tenant_id, auth_user_id)
  where auth_user_id is not null;

create or replace function public.owner_assign_branch_employee(
  p_owner_user_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_staff_id uuid,
  p_employee_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_account_type text;
begin
  if p_owner_user_id is null or p_employee_user_id is null then
    raise exception 'Owner and employee identities are required';
  end if;
  if not exists (
    select 1 from public.tenant_memberships tm
     where tm.tenant_id = p_tenant_id and tm.user_id = p_owner_user_id
       and tm.account_type = 'owner' and tm.is_active
  ) then raise exception 'Active tenant owner membership required'; end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_branch_id and b.tenant_id = p_tenant_id and b.is_active
  ) then raise exception 'Active branch not found for this tenant'; end if;

  select tm.account_type into v_account_type
    from public.tenant_memberships tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_employee_user_id
   for update;
  if v_account_type = 'owner' then
    raise exception 'An owner account cannot be converted into an employee account';
  end if;

  update public.staff_directory
     set auth_user_id = p_employee_user_id, updated_at = now()
   where id = p_staff_id and tenant_id = p_tenant_id
     and branch_id = p_branch_id and is_active
     and (auth_user_id is null or auth_user_id = p_employee_user_id);
  if not found then
    raise exception 'Active unlinked staff record not found for this branch';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, account_type, is_active)
  values (p_tenant_id, p_employee_user_id, 'employee', true)
  on conflict (tenant_id, user_id) do update
    set is_active = true
    where public.tenant_memberships.account_type = 'employee';
  if not exists (
    select 1 from public.tenant_memberships tm
     where tm.tenant_id = p_tenant_id and tm.user_id = p_employee_user_id
       and tm.account_type = 'employee' and tm.is_active
  ) then raise exception 'Employee tenant membership could not be activated'; end if;

  insert into public.branch_memberships (tenant_id, branch_id, user_id, is_active)
  values (p_tenant_id, p_branch_id, p_employee_user_id, true)
  on conflict (tenant_id, user_id) do update
    set branch_id = excluded.branch_id, is_active = true;
end;
$function$;

revoke all on function public.owner_assign_branch_employee(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.owner_assign_branch_employee(uuid,uuid,uuid,uuid,uuid) to service_role;
