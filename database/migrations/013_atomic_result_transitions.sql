-- Atomic result workflow transitions. Source candidate only; reconcile TEST migration drift before applying.
alter table public.visit_tests add column if not exists completed_by_staff_id uuid references public.staff_directory(id) on delete set null;
alter table public.visit_tests add column if not exists completed_at timestamptz;
create or replace function public.complete_visit_test_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid
)
returns public.visit_tests
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_test public.visit_tests%rowtype;
  v_is_published boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then
    raise exception 'Branch access denied';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
      and sd.branch_id = p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;

  select vt, v.is_published
    into v_test, v_is_published
    from public.visit_tests vt
    join public.visits v on v.id = vt.visit_id and v.tenant_id = vt.tenant_id
   where vt.id = p_visit_test_id and vt.tenant_id = p_tenant_id
     and vt.branch_id = p_branch_id and v.branch_id = p_branch_id
   for update of vt, v;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if coalesce(v_is_published, false) then
    raise exception 'Published visit cannot be changed through the normal completion flow';
  end if;
  if v_test.status = 'cancelled' then raise exception 'Cancelled test cannot be completed'; end if;

  if exists (
    select 1
      from jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters', '[]'::jsonb)) p
     where coalesce((p->>'is_required')::boolean, true)
       and not exists (
         select 1 from public.test_results tr
          where tr.tenant_id = p_tenant_id
            and tr.visit_test_id = p_visit_test_id
            and tr.parameter_code = p->>'code'
       )
  ) then raise exception 'Required results are missing'; end if;

  perform set_config('app.atomic_result_transition', 'on', true);
  update public.visit_tests
     set status = 'completed', completed_by_staff_id = p_staff_id, completed_at = now()
   where id = p_visit_test_id and tenant_id = p_tenant_id
   returning * into v_test;
  return v_test;
end;
$function$;

revoke all on function public.complete_visit_test_atomic(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.complete_visit_test_atomic(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.approve_visit_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_staff_id uuid
)
returns public.visits
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits%rowtype;
  v_total integer;
  v_incomplete integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then
    raise exception 'Branch access denied';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
      and sd.branch_id = p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;

  select * into v_visit
    from public.visits
   where id = p_visit_id and tenant_id = p_tenant_id and branch_id = p_branch_id
   for update;
  if not found then raise exception 'Visit not found for this tenant and branch'; end if;
  if v_visit.is_published then raise exception 'Published visit cannot be re-approved'; end if;
  if v_visit.status = 'cancelled' then raise exception 'Cancelled visit cannot be approved'; end if;

  select count(*), count(*) filter (where status <> 'completed')
    into v_total, v_incomplete
    from public.visit_tests
   where tenant_id = p_tenant_id and branch_id = p_branch_id
     and visit_id = p_visit_id and status <> 'cancelled';
  if v_total = 0 or v_incomplete > 0 then
    raise exception 'Every requested test must be completed before approval';
  end if;

  if exists (
    select 1
      from public.visit_tests vt
      cross join lateral jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters', '[]'::jsonb)) p
     where vt.tenant_id = p_tenant_id and vt.branch_id = p_branch_id
       and vt.visit_id = p_visit_id and vt.status <> 'cancelled'
       and coalesce((p->>'is_required')::boolean, true)
       and not exists (
         select 1 from public.test_results tr
          where tr.tenant_id = p_tenant_id
            and tr.visit_test_id = vt.id
            and tr.parameter_code = p->>'code'
       )
  ) then raise exception 'Required results are missing; approval is blocked'; end if;

  perform set_config('app.atomic_result_transition', 'on', true);
  update public.visits
     set status = 'approved',
         approved_by_staff_id = p_staff_id,
         approved_at = now()
   where id = p_visit_id and tenant_id = p_tenant_id and branch_id = p_branch_id
   returning * into v_visit;
  return v_visit;
end;
$function$;

revoke all on function public.approve_visit_atomic(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.approve_visit_atomic(uuid,uuid,uuid,uuid) to authenticated;

-- Prevent browser-side direct updates from bypassing the atomic completion/approval RPCs.
create or replace function private.guard_result_workflow_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $function$
begin
  if current_setting('app.atomic_result_transition', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'visit_tests' then
    if new.status is distinct from old.status and new.status = 'completed' then
      raise exception 'Complete tests through complete_visit_test_atomic';
    end if;
    if new.completed_by_staff_id is distinct from old.completed_by_staff_id
       or new.completed_at is distinct from old.completed_at then
      raise exception 'Completion audit fields are server-managed';
    end if;
  elsif tg_table_name = 'visits' then
    if new.status is distinct from old.status and new.status = 'approved' then
      raise exception 'Approve visits through approve_visit_atomic';
    end if;
    if new.approved_by_staff_id is distinct from old.approved_by_staff_id
       or new.approved_at is distinct from old.approved_at then
      raise exception 'Approval audit fields are server-managed';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_result_workflow_transition() from public, anon;
grant execute on function private.guard_result_workflow_transition() to authenticated, service_role;

drop trigger if exists guard_atomic_visit_test_completion on public.visit_tests;
create trigger guard_atomic_visit_test_completion
before update on public.visit_tests
for each row execute function private.guard_result_workflow_transition();

drop trigger if exists guard_atomic_visit_approval on public.visits;
create trigger guard_atomic_visit_approval
before update on public.visits
for each row execute function private.guard_result_workflow_transition();
