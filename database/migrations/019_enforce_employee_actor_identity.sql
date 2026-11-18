-- Enforce that employee accounts can only act under their own linked staff identity.
-- Owners retain operational authority; employee accounts are bound to auth.uid().
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

drop trigger if exists enforce_employee_staff_identity_visits on public.visits;
create trigger enforce_employee_staff_identity_visits
before insert or update on public.visits
for each row execute function private.enforce_authenticated_staff_identity('created_by_staff_id','approved_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_visit_tests on public.visit_tests;
create trigger enforce_employee_staff_identity_visit_tests
before insert or update on public.visit_tests
for each row execute function private.enforce_authenticated_staff_identity('created_by_staff_id','completed_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_test_results on public.test_results;
create trigger enforce_employee_staff_identity_test_results
before insert or update on public.test_results
for each row execute function private.enforce_authenticated_staff_identity('entered_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_payments on public.payments;
create trigger enforce_employee_staff_identity_payments
before insert or update on public.payments
for each row execute function private.enforce_authenticated_staff_identity('received_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_expenses on public.expenses;
create trigger enforce_employee_staff_identity_expenses
before insert or update on public.expenses
for each row execute function private.enforce_authenticated_staff_identity('spent_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_workdays on public.branch_workdays;
create trigger enforce_employee_staff_identity_workdays
before insert or update on public.branch_workdays
for each row execute function private.enforce_authenticated_staff_identity('opened_by_staff_id','closed_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_reports on public.report_versions;
create trigger enforce_employee_staff_identity_reports
before insert or update on public.report_versions
for each row execute function private.enforce_authenticated_staff_identity('published_by_staff_id');

drop trigger if exists enforce_employee_staff_identity_audit on public.audit_logs;
create trigger enforce_employee_staff_identity_audit
before insert or update on public.audit_logs
for each row execute function private.enforce_authenticated_staff_identity('actor_staff_id');

-- Patient creation is also attributed to the authenticated employee.
drop trigger if exists enforce_employee_staff_identity_patients on public.patients;
create trigger enforce_employee_staff_identity_patients
before insert or update on public.patients
for each row execute function private.enforce_authenticated_staff_identity('created_by_staff_id');

-- Attribute audit events to the authenticated employee, not the original creator
-- of a row. This matters when a different shift employee completes or approves it.
create or replace function private.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  j_new jsonb;
  j_old jsonb;
  v_tenant uuid;
  v_branch uuid;
  v_id text;
  v_staff uuid;
begin
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  v_tenant := coalesce(nullif(j_new->>'tenant_id','')::uuid, nullif(j_old->>'tenant_id','')::uuid);
  v_branch := coalesce(nullif(j_new->>'branch_id','')::uuid, nullif(j_old->>'branch_id','')::uuid);
  v_id := coalesce(j_new->>'id', j_old->>'id');

  if auth.uid() is not null and v_tenant is not null then
    select sd.id into v_staff
      from public.staff_directory sd
      join public.tenant_memberships tm
        on tm.tenant_id=sd.tenant_id and tm.user_id=auth.uid()
       and tm.account_type='employee' and tm.is_active
     where sd.tenant_id=v_tenant and sd.auth_user_id=auth.uid()
       and sd.is_active and (v_branch is null or sd.branch_id=v_branch)
     limit 1;
  end if;

  if v_staff is null then
    v_staff := coalesce(
      nullif(j_new->>'completed_by_staff_id',''), nullif(j_new->>'approved_by_staff_id',''),
      nullif(j_new->>'published_by_staff_id',''), nullif(j_new->>'entered_by_staff_id',''),
      nullif(j_new->>'received_by_staff_id',''), nullif(j_new->>'spent_by_staff_id',''),
      nullif(j_new->>'closed_by_staff_id',''), nullif(j_new->>'opened_by_staff_id',''),
      nullif(j_new->>'created_by_staff_id',''),
      nullif(j_old->>'completed_by_staff_id',''), nullif(j_old->>'approved_by_staff_id',''),
      nullif(j_old->>'published_by_staff_id',''), nullif(j_old->>'entered_by_staff_id',''),
      nullif(j_old->>'received_by_staff_id',''), nullif(j_old->>'spent_by_staff_id',''),
      nullif(j_old->>'closed_by_staff_id',''), nullif(j_old->>'opened_by_staff_id',''),
      nullif(j_old->>'created_by_staff_id','')
    )::uuid;
  end if;

  if v_tenant is not null then
    insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_staff_id,action,table_name,record_id,old_data,new_data)
    values (v_tenant,v_branch,auth.uid(),v_staff,lower(tg_op),tg_table_name,v_id,
      case when tg_op='INSERT' then null else j_old end,
      case when tg_op='DELETE' then null else j_new end);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
