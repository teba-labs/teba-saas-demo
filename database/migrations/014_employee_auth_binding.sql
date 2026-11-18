-- Employee Auth binding and owner-controlled branch access.
-- Candidate source migration only. Reconcile the live TEST schema before applying.
alter table public.staff_directory
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists staff_directory_tenant_auth_user_uidx
  on public.staff_directory(tenant_id, auth_user_id)
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
  v_membership public.tenant_memberships%rowtype;
  v_staff public.staff_directory%rowtype;
begin
  if p_owner_user_id is null or p_employee_user_id is null
     or p_owner_user_id = p_employee_user_id then
    raise exception 'Invalid owner or employee identity';
  end if;

  if not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id and tm.user_id = p_owner_user_id
      and tm.account_type = 'owner' and tm.is_active
  ) then raise exception 'Active tenant owner required'; end if;

  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.tenant_id = p_tenant_id and b.is_active
  ) then raise exception 'Active branch not found'; end if;

  select * into v_staff
    from public.staff_directory sd
   where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
     and sd.branch_id = p_branch_id
   for update;
  if not found or not v_staff.is_active then
    raise exception 'Active operational staff identity required';
  end if;
  if v_staff.auth_user_id is not null and v_staff.auth_user_id <> p_employee_user_id then
    raise exception 'Operational staff identity is already linked';
  end if;
  if exists (
    select 1 from public.staff_directory sd
    where sd.tenant_id = p_tenant_id and sd.auth_user_id = p_employee_user_id
      and sd.id <> p_staff_id
  ) then raise exception 'Employee account is already linked to another staff identity in this tenant'; end if;

  select * into v_membership
    from public.tenant_memberships tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_employee_user_id
   for update;
  if found then
    if v_membership.account_type <> 'employee' then
      raise exception 'This account already has a non-employee role in the tenant';
    end if;
    update public.tenant_memberships set is_active = true
     where id = v_membership.id;
  else
    insert into public.tenant_memberships(tenant_id, user_id, account_type, is_active)
    values (p_tenant_id, p_employee_user_id, 'employee', true);
  end if;

  insert into public.branch_memberships(tenant_id, branch_id, user_id, is_active)
  values (p_tenant_id, p_branch_id, p_employee_user_id, true)
  on conflict (tenant_id, user_id) do update
    set branch_id = excluded.branch_id, is_active = true;

  update public.staff_directory
     set auth_user_id = p_employee_user_id, is_active = true, updated_at = now()
   where id = p_staff_id and tenant_id = p_tenant_id and branch_id = p_branch_id;
end;
$function$;

create or replace function public.owner_set_branch_employee_active(
  p_owner_user_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_staff_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_staff public.staff_directory%rowtype;
begin
  if p_owner_user_id is null or p_is_active is null then
    raise exception 'Owner identity and active state are required';
  end if;
  if not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id and tm.user_id = p_owner_user_id
      and tm.account_type = 'owner' and tm.is_active
  ) then raise exception 'Active tenant owner required'; end if;

  select * into v_staff
    from public.staff_directory sd
   where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
     and sd.branch_id = p_branch_id
   for update;
  if not found or v_staff.auth_user_id is null then
    raise exception 'Linked operational staff identity not found';
  end if;

  update public.staff_directory
     set is_active = p_is_active, updated_at = now()
   where id = p_staff_id and tenant_id = p_tenant_id and branch_id = p_branch_id;

  update public.branch_memberships
     set is_active = p_is_active
   where tenant_id = p_tenant_id and branch_id = p_branch_id
     and user_id = v_staff.auth_user_id;

  update public.tenant_memberships
     set is_active = p_is_active
   where tenant_id = p_tenant_id and user_id = v_staff.auth_user_id
     and account_type = 'employee';
end;
$function$;

revoke all on function public.owner_assign_branch_employee(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.owner_assign_branch_employee(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.owner_set_branch_employee_active(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.owner_set_branch_employee_active(uuid,uuid,uuid,uuid,boolean) to service_role;
