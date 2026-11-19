-- Reorder employee reactivation so tenant membership is active before branch membership.
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
  v_employee_user_id uuid;
  v_active boolean := coalesce(p_is_active, false);
begin
  if not exists (
    select 1 from public.tenant_memberships tm
     where tm.tenant_id = p_tenant_id and tm.user_id = p_owner_user_id
       and tm.account_type = 'owner' and tm.is_active
  ) then raise exception 'Active tenant owner membership required'; end if;

  update public.staff_directory
     set is_active = v_active, updated_at = now()
   where id = p_staff_id and tenant_id = p_tenant_id
     and branch_id = p_branch_id and auth_user_id is not null
   returning auth_user_id into v_employee_user_id;
  if not found then raise exception 'Linked employee record not found'; end if;

  if v_active then
    -- The branch-membership guard requires an active tenant membership first.
    update public.tenant_memberships
       set is_active = true
     where tenant_id = p_tenant_id and user_id = v_employee_user_id
       and account_type = 'employee';
    if not found then raise exception 'Employee tenant membership not found'; end if;

    update public.branch_memberships
       set is_active = true
     where tenant_id = p_tenant_id and branch_id = p_branch_id
       and user_id = v_employee_user_id;
    if not found then raise exception 'Branch membership not found'; end if;
  else
    -- Deactivation removes branch access before disabling tenant membership.
    update public.branch_memberships
       set is_active = false
     where tenant_id = p_tenant_id and branch_id = p_branch_id
       and user_id = v_employee_user_id;
    if not found then raise exception 'Branch membership not found'; end if;

    update public.tenant_memberships
       set is_active = false
     where tenant_id = p_tenant_id and user_id = v_employee_user_id
       and account_type = 'employee';
    if not found then raise exception 'Employee tenant membership not found'; end if;
  end if;
end;
$function$;
revoke all on function public.owner_set_branch_employee_active(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.owner_set_branch_employee_active(uuid,uuid,uuid,uuid,boolean) to service_role;
