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
  foreach v_field in array tg_argv loop
    v_staff_id := nullif(v_row->>v_field, '')::uuid;
    if v_staff_id is not null and not exists (
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
