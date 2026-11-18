-- Batch 23: save all entered draft parameters for one visit test atomically.
-- Apply only after reviewing migrations 001-009 on the intended TEST project.

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
as $$
declare
  v_visit_id uuid;
  v_is_published boolean;
  v_status text;
  v_branch_id uuid;
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

  select vt.visit_id, vt.branch_id, v.is_published, v.status
    into v_visit_id, v_branch_id, v_is_published, v_status
    from public.visit_tests vt
    join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id
     and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v, vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if coalesce(v_is_published,false) or v_status='published' then
    raise exception 'This visit is already published. Use the audited report-correction workflow.';
  end if;

  select count(distinct x.parameter_code) into v_distinct_count
    from jsonb_to_recordset(p_results) as x(parameter_code text);
  if v_distinct_count <> v_count or exists (
    select 1 from jsonb_to_recordset(p_results) as x(parameter_code text)
     where nullif(btrim(x.parameter_code),'') is null
  ) then
    raise exception 'Each submitted result must have one unique parameter code';
  end if;

  -- The trigger chain validates each value against the frozen visit snapshot.
  -- Any invalid row aborts this entire function call and rolls back all rows.
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
$$;

revoke all on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;

comment on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) is
  'Atomically upserts a batch of draft result values for one visit test; snapshot validation and published-result guards remain enforced by database triggers.';
