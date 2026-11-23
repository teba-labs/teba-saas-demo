-- 085: Remove stale result values when conditional choice rules change.
-- Also mirror main UI semantics when a condition source is a multi-choice parameter.
-- Forward-only correction after 084; no catalog or patient data is rewritten at migration time.
begin;

create or replace function private.result_parameter_value_matches_display_rules(
  p_tenant_id uuid,p_visit_test_id uuid,p_rules jsonb,p_pending_results jsonb,p_value_numeric numeric,p_value_text text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rule jsonb; v_source text; v_expected text; v_actual text; v_operator text;
  v_allowed jsonb; v_condition_met boolean; v_selected jsonb; v_candidate text;
begin
  if p_rules is null then return true; end if;
  if jsonb_typeof(p_rules)<>'array' then return false; end if;
  if jsonb_array_length(p_rules)=0 then return true; end if;
  if p_value_numeric is not null and p_value_text is null then return true; end if;
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    v_allowed:=case when jsonb_typeof(v_rule->'choices')='array' then v_rule->'choices'
                    when jsonb_typeof(v_rule->'visible_values')='array' then v_rule->'visible_values' else null end;
    if v_allowed is null or jsonb_array_length(v_allowed)=0 then continue; end if;
    v_source:=coalesce(nullif(btrim(v_rule->>'source_parameter_code'),''),nullif(btrim(v_rule->'when'->>'parameter_code'),''));
    v_expected:=coalesce(v_rule->>'value',v_rule->'when'->>'value','');
    v_operator:=coalesce(v_rule->>'operator',v_rule->'when'->>'operator','equals');
    if v_source is null then return false; end if;
    select coalesce(x.value_text,x.value_numeric::text) into v_actual
      from jsonb_to_recordset(coalesce(p_pending_results,'[]'::jsonb)) as x(parameter_code text,value_numeric numeric,value_text text)
     where x.parameter_code=v_source limit 1;
    if v_actual is null then
      select coalesce(tr.value_text,tr.value_numeric::text) into v_actual
        from public.test_results tr where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id and tr.parameter_code=v_source limit 1;
    end if;
    v_condition_met:=case when v_operator='equals' then v_actual is not distinct from v_expected
      when v_operator='not_equals' then v_actual is not null and v_actual<>v_expected
      when v_operator='is_not_empty' then nullif(btrim(coalesce(v_actual,'')),'') is not null else false end;
    if not v_condition_met then continue; end if;
    if p_value_text is null then return false; end if;
    begin
      if left(btrim(p_value_text),1) in ('[','{') then
        v_selected:=p_value_text::jsonb;
        if jsonb_typeof(v_selected)='object' then v_selected:=v_selected->'selected'; end if;
        if jsonb_typeof(v_selected)<>'array' then return false; end if;
      else v_selected:=jsonb_build_array(p_value_text); end if;
    exception when others then return false; end;
    for v_candidate in select jsonb_array_elements_text(v_selected) loop
      if not (v_allowed @> jsonb_build_array(v_candidate)) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_visit_test_atomic(p_tenant_id uuid, p_branch_id uuid, p_visit_test_id uuid, p_staff_id uuid)
 RETURNS visit_tests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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

  delete from public.test_results tr
   using jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters','[]'::jsonb)) p
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_is_visible(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb
     );

  -- Clear a stored choice that became disallowed after its controller value changed.
  delete from public.test_results tr
   using jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters','[]'::jsonb)) p
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_value_matches_display_rules(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb,
       tr.value_numeric,tr.value_text
     );

  if exists (
    select 1
      from jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters', '[]'::jsonb)) p
     where coalesce((p->>'is_required')::boolean, true)
       and private.result_parameter_is_visible(p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb)
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

CREATE OR REPLACE FUNCTION public.approve_visit_atomic(p_tenant_id uuid, p_branch_id uuid, p_visit_id uuid, p_staff_id uuid)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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

  delete from public.test_results tr
   using public.visit_tests vt,
         jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.visit_id=p_visit_id
     and vt.status <> 'cancelled'
     and tr.tenant_id=p_tenant_id and tr.visit_test_id=vt.id and tr.parameter_code=p->>'code'
     and not private.result_parameter_is_visible(
       p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb
     );

  -- Remove previously saved values that are no longer allowed by the current controller values.
  delete from public.test_results tr
   using public.visit_tests vt,
         jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.visit_id=p_visit_id
     and vt.status <> 'cancelled'
     and tr.tenant_id=p_tenant_id and tr.visit_test_id=vt.id and tr.parameter_code=p->>'code'
     and not private.result_parameter_value_matches_display_rules(
       p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb,
       tr.value_numeric,tr.value_text
     );

  if exists (
    select 1
      from public.visit_tests vt
      cross join lateral jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters', '[]'::jsonb)) p
     where vt.tenant_id = p_tenant_id and vt.branch_id = p_branch_id
       and vt.visit_id = p_visit_id and vt.status <> 'cancelled'
       and coalesce((p->>'is_required')::boolean, true)
       and private.result_parameter_is_visible(p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb)
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

CREATE OR REPLACE FUNCTION public.save_draft_results_atomic(p_tenant_id uuid, p_branch_id uuid, p_visit_test_id uuid, p_staff_id uuid, p_results jsonb)
 RETURNS SETOF test_results
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_visit_id uuid; v_is_published boolean; v_visit_status text; v_test_status text;
  v_count integer; v_distinct_count integer; v_snapshot jsonb; v_values jsonb;
  v_param jsonb; v_pending jsonb; v_formula numeric; v_done integer; v_pass integer;
  v_code text; v_scale integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd where sd.id=p_staff_id
      and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if p_results is null or jsonb_typeof(p_results)<>'array' then raise exception 'Results must be supplied as a JSON array'; end if;
  v_count:=jsonb_array_length(p_results);
  if v_count<1 or v_count>100 then raise exception 'Submit between 1 and 100 manual result values'; end if;
  select vt.visit_id,vt.status,v.is_published,v.status,vt.technical_snapshot
    into v_visit_id,v_test_status,v_is_published,v_visit_status,v_snapshot
    from public.visit_tests vt join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v,vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if v_test_status='completed' then raise exception 'Completed test results are locked'; end if;
  if coalesce(v_is_published,false) or v_visit_status in ('approved','published') then raise exception 'Approved or published visit results are locked'; end if;
  if v_test_status='cancelled' then raise exception 'Cancelled test results cannot be changed'; end if;

  select count(distinct x.parameter_code) into v_distinct_count
    from jsonb_to_recordset(p_results) as x(parameter_code text);
  if v_distinct_count<>v_count or exists(select 1 from jsonb_to_recordset(p_results) as x(parameter_code text) where nullif(btrim(x.parameter_code),'') is null) then
    raise exception 'Each submitted result must have one unique parameter code';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_results) x(parameter_code text,value_numeric numeric,value_text text)
      join jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
        on p->>'code'=x.parameter_code
     where not private.result_value_matches_input_mode(
       p->>'result_input_mode',p->>'value_type',coalesce(p->'choices','[]'::jsonb),
       coalesce(p->'result_config','{}'::jsonb),x.value_numeric,x.value_text
     )
        or not private.result_parameter_value_matches_display_rules(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),
       p_results,x.value_numeric,x.value_text
     )
  ) then raise exception 'One or more values do not match the configured result input type'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_results) x(parameter_code text,value_numeric numeric,value_text text)
      join jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
        on p->>'code'=x.parameter_code
     where not private.result_parameter_is_visible(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),p_results
     )
  ) then raise exception 'A result was submitted for a field hidden by its display rules'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_results) x(parameter_code text)
     where not exists (
       select 1 from jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
        where p->>'code'=x.parameter_code
     )
  ) then raise exception 'A submitted parameter does not exist in the visit technical snapshot'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_results) x(parameter_code text)
    join jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p on p->>'code'=x.parameter_code
    where coalesce(p->>'result_source','manual')='calculated'
  ) then raise exception 'Calculated parameters cannot be entered manually'; end if;

  insert into public.test_results(tenant_id,visit_test_id,parameter_code,value_numeric,value_text,flag,entered_by,entered_by_staff_id)
  select p_tenant_id,p_visit_test_id,x.parameter_code,x.value_numeric,x.value_text,x.flag,auth.uid(),p_staff_id
    from jsonb_to_recordset(p_results) as x(parameter_code text,value_numeric numeric,value_text text,flag text)
  on conflict (visit_test_id,parameter_code) do update set
    value_numeric=excluded.value_numeric,value_text=excluded.value_text,flag=excluded.flag,
    entered_by=excluded.entered_by,entered_by_staff_id=excluded.entered_by_staff_id,updated_at=now();

  -- Remove previously stored values for parameters that became hidden after a controller value changed.
  delete from public.test_results tr
   using jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_is_visible(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb
     );

  -- Clear old values whose options became hidden after the submitted controller values changed.
  delete from public.test_results tr
   using jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_value_matches_display_rules(
       p_tenant_id,p_visit_test_id,coalesce(p->'display_rules','[]'::jsonb),p_results,
       tr.value_numeric,tr.value_text
     );

  select coalesce(jsonb_object_agg(tr.parameter_code,tr.value_numeric),'{}'::jsonb) into v_values
    from public.test_results tr
    join jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
      on p->>'code'=tr.parameter_code and coalesce(p->>'result_source','manual')='manual'
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id and tr.value_numeric is not null;

  select coalesce(jsonb_agg(p),'[]'::jsonb) into v_pending
    from jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
   where coalesce(p->>'result_source','manual')='calculated';
  v_done:=0;
  while jsonb_array_length(v_pending)>0 loop
    v_pass:=0;
    for v_param in select value from jsonb_array_elements(v_pending) loop
      if not exists (
        select 1 from private.catalog_formula_refs(v_param->'formula') ref
         where not (v_values ? ref.parameter_code)
      ) then
        v_code:=v_param->>'code';
        v_formula:=round(private.evaluate_catalog_formula(v_param->'formula',v_values),
          least(6,greatest(0,coalesce((v_param->>'decimal_places')::integer,2))));
        if v_formula is null then
          delete from public.test_results where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=v_code;
        else
          insert into public.test_results(tenant_id,visit_test_id,parameter_code,value_numeric,value_text,flag,entered_by,entered_by_staff_id)
          values(p_tenant_id,p_visit_test_id,v_code,v_formula,null,null,auth.uid(),p_staff_id)
          on conflict (visit_test_id,parameter_code) do update set
            value_numeric=excluded.value_numeric,value_text=null,flag=null,
            entered_by=excluded.entered_by,entered_by_staff_id=excluded.entered_by_staff_id,updated_at=now();
          v_values:=jsonb_set(v_values,array[v_code],to_jsonb(v_formula),true);
          v_pass:=v_pass+1;
        end if;
      end if;
    end loop;
    if v_pass=0 then exit; end if;
    v_done:=v_done+v_pass;
    if v_done>100 then raise exception 'Too many calculated parameters in this test'; end if;
    select coalesce(jsonb_agg(p),'[]'::jsonb) into v_pending
      from jsonb_array_elements(v_pending) p
     where not (v_values ? (p->>'code'));
  end loop;

  return query select * from public.test_results tr
   where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
   order by tr.parameter_code;
end;
$function$;

commit;
