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

  -- Lock the parent visit first, then its test row, matching the draft-save lock order.
  select v.is_published into v_is_published
    from public.visits v
    join public.visit_tests vt on vt.visit_id = v.id and vt.tenant_id = v.tenant_id
   where vt.id = p_visit_test_id and vt.tenant_id = p_tenant_id
     and vt.branch_id = p_branch_id and v.branch_id = p_branch_id
   for update of v;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;

  select * into v_test
    from public.visit_tests
   where id = p_visit_test_id and tenant_id = p_tenant_id and branch_id = p_branch_id
   for update;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if coalesce(v_is_published, false) then
    raise exception 'Published visit cannot be changed through the normal completion flow';
  end if;
  if v_test.status = 'cancelled' then raise exception 'Cancelled test cannot be completed'; end if;
  if v_test.status = 'completed' then raise exception 'Test is already completed'; end if;

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
  if v_visit.status = 'approved' then raise exception 'Visit is already approved'; end if;
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

-- Draft results are locked after a test is completed or its visit is approved.
-- Corrections to a published report remain available only through correct_published_result.
create or replace function public.save_draft_results_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid,
  p_results jsonb
)
returns setof public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit_id uuid;
  v_is_published boolean;
  v_visit_status text;
  v_test_status text;
  v_count integer;
  v_distinct_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'Results must be supplied as a JSON array';
  end if;
  v_count := jsonb_array_length(p_results);
  if v_count < 1 or v_count > 100 then raise exception 'Submit between 1 and 100 result values'; end if;

  select vt.visit_id, vt.status, v.is_published, v.status
    into v_visit_id, v_test_status, v_is_published, v_visit_status
    from public.visit_tests vt
    join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id
     and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v, vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if v_test_status = 'completed' then
    raise exception 'Completed test results are locked; use the audited correction workflow if already published';
  end if;
  if coalesce(v_is_published,false) or v_visit_status in ('approved','published') then
    raise exception 'Approved or published visit results are locked';
  end if;
  if v_test_status = 'cancelled' then raise exception 'Cancelled test results cannot be changed'; end if;

  select count(distinct x.parameter_code) into v_distinct_count
    from jsonb_to_recordset(p_results) as x(parameter_code text);
  if v_distinct_count <> v_count or exists (
    select 1 from jsonb_to_recordset(p_results) as x(parameter_code text)
     where nullif(btrim(x.parameter_code),'') is null
  ) then
    raise exception 'Each submitted result must have one unique parameter code';
  end if;

  return query
    insert into public.test_results(
      tenant_id, visit_test_id, parameter_code,
      value_numeric, value_text, flag,
      entered_by, entered_by_staff_id
    )
    select p_tenant_id, p_visit_test_id, x.parameter_code,
           x.value_numeric, x.value_text, x.flag,
           auth.uid(), p_staff_id
      from jsonb_to_recordset(p_results) as x(
        parameter_code text, value_numeric numeric, value_text text, flag text
      )
    on conflict (visit_test_id, parameter_code) do update set
      value_numeric=excluded.value_numeric,
      value_text=excluded.value_text,
      flag=excluded.flag,
      entered_by=excluded.entered_by,
      entered_by_staff_id=excluded.entered_by_staff_id,
      updated_at=now()
    returning *;
end;
$function$;

revoke all on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
