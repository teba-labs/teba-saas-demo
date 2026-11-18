-- Correct actor identity enforcement for nullable future-action fields.
create or replace function private.enforce_authenticated_staff_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_old jsonb;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_staff_id uuid;
  v_field text;
  v_account_type text;
begin
  if auth.uid() is null then return new; end if;
  v_tenant_id := nullif(v_row->>'tenant_id', '')::uuid;
  if v_tenant_id is null then return new; end if;

  select tm.account_type into v_account_type
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
     and tm.user_id = auth.uid()
     and tm.is_active;
  if v_account_type is distinct from 'employee' then return new; end if;

  v_branch_id := nullif(v_row->>'branch_id', '')::uuid;
  if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if;
  foreach v_field in array tg_argv loop
    if tg_op = 'UPDATE' and (v_row->>v_field) is not distinct from (v_old->>v_field) then
      continue;
    end if;
    v_staff_id := nullif(v_row->>v_field, '')::uuid;
    if v_staff_id is null then
      if tg_op = 'INSERT' and v_field in ('approved_by_staff_id','completed_by_staff_id','closed_by_staff_id') then
        continue;
      end if;
      raise exception 'Employee actions must include the authenticated linked staff identity';
    end if;
    if not exists (
      select 1 from public.staff_directory sd
       where sd.id = v_staff_id
         and sd.tenant_id = v_tenant_id
         and sd.auth_user_id = auth.uid()
         and sd.is_active
         and (v_branch_id is null or sd.branch_id = v_branch_id)
    ) then
      raise exception 'Employee accounts may only act as their own linked active staff identity';
    end if;
  end loop;
  return new;
end;
$function$;

revoke all on function private.enforce_authenticated_staff_identity() from public, anon;
grant execute on function private.enforce_authenticated_staff_identity() to authenticated, service_role;
