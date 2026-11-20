-- Safe server-side calculated parameters for tenant catalog tests.
alter table public.test_parameters
  add column if not exists result_source text not null default 'manual',
  add column if not exists formula jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.test_parameters'::regclass and conname='test_parameters_result_source_check') then
    alter table public.test_parameters add constraint test_parameters_result_source_check
      check (result_source in ('manual','calculated'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.test_parameters'::regclass and conname='test_parameters_calculation_shape_check') then
    alter table public.test_parameters add constraint test_parameters_calculation_shape_check
      check ((result_source='manual' and formula is null) or
             (result_source='calculated' and value_type='numeric' and formula is not null and jsonb_typeof(formula)='object'));
  end if;
end $$;

create or replace function private.catalog_formula_refs(p_expr jsonb)
returns table(parameter_code text)
language sql immutable
set search_path = pg_catalog
as $$
  with recursive nodes(value) as (
    select p_expr
    union all
    select child.value
      from nodes n
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(n.value->'args')='array' then n.value->'args' else '[]'::jsonb end
      ) child(value)
  )
  select distinct value->>'param'
    from nodes
   where jsonb_typeof(value)='object'
     and nullif(value->>'param','') is not null;
$$;

create or replace function private.validate_formula_ast(p_expr jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, private
as $formula_ast$
declare
  v_op text; v_args jsonb; v_count integer; v_item jsonb;
begin
  if jsonb_typeof(p_expr)='number' then return true; end if;
  if jsonb_typeof(p_expr)<>'object' then return false; end if;
  if p_expr ? 'param' then
    return (p_expr - 'param')='{}'::jsonb and jsonb_typeof(p_expr->'param')='string'
      and length(btrim(p_expr->>'param'))>0;
  end if;
  if p_expr ? 'const' then
    return (p_expr - 'const')='{}'::jsonb and jsonb_typeof(p_expr->'const')='number';
  end if;
  v_op:=p_expr->>'op'; v_args:=p_expr->'args';
  if not (p_expr ? 'op' and p_expr ? 'args') or (p_expr - 'op' - 'args')<>'{}'::jsonb or jsonb_typeof(v_args)<>'array' then return false; end if;
  v_count:=jsonb_array_length(v_args);
  if v_op in ('add','multiply','min','max') then
    if v_count<2 then return false; end if;
  elsif v_op in ('subtract','divide') then
    if v_count<>2 then return false; end if;
  elsif v_op='abs' then
    if v_count<>1 then return false; end if;
  elsif v_op='round' then
    if v_count not in (1,2) then return false; end if;
  else return false;
  end if;
  for v_item in select value from jsonb_array_elements(v_args) loop
    if not private.validate_formula_ast(v_item) then return false; end if;
  end loop;
  return true;
end;
$formula_ast$;

revoke all on function private.validate_formula_ast(jsonb) from public,anon,authenticated;

create or replace function private.validate_catalog_parameter_formula()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_ref text;
  v_bad text;
begin
  if tg_op='UPDATE' and old.parameter_code is distinct from new.parameter_code then
    if exists (select 1 from public.test_parameters p
      cross join lateral private.catalog_formula_refs(p.formula) ref
      where p.tenant_id=old.tenant_id and p.test_id=old.test_id
        and p.result_source='calculated' and p.is_active
        and ref.parameter_code=old.parameter_code and p.id<>old.id) then
      raise exception 'This parameter is used by a calculated parameter; keep its code stable';
    end if;
  end if;
  if tg_op='UPDATE' and (not new.is_active or new.value_type<>'numeric') then
    if exists (select 1 from public.test_parameters p
      cross join lateral private.catalog_formula_refs(p.formula) ref
      where p.tenant_id=old.tenant_id and p.test_id=old.test_id
        and p.result_source='calculated' and p.is_active
        and ref.parameter_code=old.parameter_code and p.id<>old.id) then
      raise exception 'This parameter is used by a calculated parameter; update or deactivate dependent formulas first';
    end if;
  end if;
  if new.result_source='manual' then
    if new.formula is not null then raise exception 'Manual parameters cannot have a formula'; end if;
    return new;
  end if;
  if new.result_source<>'calculated' or new.value_type<>'numeric' or jsonb_typeof(new.formula)<>'object' or not private.validate_formula_ast(new.formula) then
    raise exception 'Calculated parameters must be numeric and have a valid formula';
  end if;
  if coalesce(new.is_active,false)=false then return new; end if;
  if not exists (select 1 from private.catalog_formula_refs(new.formula)) then
    raise exception 'Formula must reference at least one parameter';
  end if;
  for v_ref in select parameter_code from private.catalog_formula_refs(new.formula) loop
    if v_ref=new.parameter_code then raise exception 'A parameter cannot refer to itself'; end if;
    if not exists (
      select 1 from public.test_parameters p
       where p.tenant_id=new.tenant_id and p.test_id=new.test_id
         and p.parameter_code=v_ref and p.is_active and p.value_type='numeric'
    ) then
      raise exception 'Formula reference % must be an existing active numeric parameter in this test',v_ref;
    end if;
  end loop;

  with recursive walk(code,path,cycle) as (
    select parameter_code, array[new.parameter_code,parameter_code], parameter_code=new.parameter_code
      from private.catalog_formula_refs(new.formula)
    union all
    select ref.parameter_code, w.path || ref.parameter_code, ref.parameter_code=any(w.path)
      from walk w
      join public.test_parameters p
        on p.tenant_id=new.tenant_id and p.test_id=new.test_id
       and p.parameter_code=w.code and p.result_source='calculated' and p.is_active
      cross join lateral private.catalog_formula_refs(p.formula) ref
     where not w.cycle
  )
  select code into v_bad from walk where cycle limit 1;
  if v_bad is not null then raise exception 'Calculated parameter dependency cycle detected'; end if;
  return new;
end;
$$;

revoke all on function private.validate_catalog_parameter_formula() from public,anon,authenticated;
drop trigger if exists validate_catalog_parameter_formula on public.test_parameters;
create trigger validate_catalog_parameter_formula
before insert or update of parameter_code,tenant_id,test_id,value_type,result_source,formula,is_active
on public.test_parameters
for each row execute function private.validate_catalog_parameter_formula();

create or replace function private.evaluate_catalog_formula(p_expr jsonb,p_values jsonb)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_op text;
  v_args jsonb;
  v_left numeric;
  v_right numeric;
  v_result numeric;
  v_count integer;
  v_item jsonb;
begin
  if jsonb_typeof(p_expr)='number' then return (p_expr#>>'{}')::numeric; end if;
  if jsonb_typeof(p_expr)<>'object' then raise exception 'Invalid formula expression'; end if;
  if p_expr ? 'const' then
    if jsonb_typeof(p_expr->'const')<>'number' then raise exception 'Formula constants must be numeric'; end if;
    return (p_expr->>'const')::numeric;
  end if;
  if p_expr ? 'param' then
    if not (p_values ? (p_expr->>'param')) then raise exception 'Formula input % has no result yet',p_expr->>'param'; end if;
    return (p_values->>(p_expr->>'param'))::numeric;
  end if;
  v_op:=p_expr->>'op'; v_args:=p_expr->'args';
  if jsonb_typeof(v_args)<>'array' then raise exception 'Formula arguments must be an array'; end if;
  v_count:=jsonb_array_length(v_args);
  if v_op in ('add','multiply','min','max') then
    if v_count<2 then raise exception 'Formula operation % requires at least two inputs',v_op; end if;
    v_result:=private.evaluate_catalog_formula(v_args->0,p_values);
    for i in 1..(v_count-1) loop
      v_item:=v_args->i;
      v_right:=private.evaluate_catalog_formula(v_item,p_values);
      if v_op='add' then v_result:=v_result+v_right;
      elsif v_op='multiply' then v_result:=v_result*v_right;
      elsif v_op='min' then v_result:=least(v_result,v_right);
      else v_result:=greatest(v_result,v_right); end if;
    end loop;
    return v_result;
  elsif v_op in ('subtract','divide') then
    if v_count<>2 then raise exception 'Formula operation % requires exactly two inputs',v_op; end if;
    v_left:=private.evaluate_catalog_formula(v_args->0,p_values);
    v_right:=private.evaluate_catalog_formula(v_args->1,p_values);
    if v_op='divide' and v_right=0 then raise exception 'Cannot divide by zero in calculated parameter'; end if;
    if v_op='subtract' then return v_left-v_right; end if;
    return v_left/v_right;
  elsif v_op in ('abs','round') then
    if v_count<1 or v_count>2 then raise exception 'Formula operation % has invalid argument count',v_op; end if;
    v_left:=private.evaluate_catalog_formula(v_args->0,p_values);
    if v_op='abs' then return abs(v_left); end if;
    if v_count=2 then
      v_right:=private.evaluate_catalog_formula(v_args->1,p_values);
      if v_right<>trunc(v_right) or v_right<0 or v_right>6 then raise exception 'Round precision must be from 0 to 6'; end if;
      return round(v_left,v_right::integer);
    end if;
    return round(v_left);
  end if;
  raise exception 'Unsupported formula operation: %',v_op;
end;
$$;

revoke all on function private.evaluate_catalog_formula(jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.catalog_formula_refs(jsonb) from public,anon,authenticated;

-- Keep the complete technical definition on each ordered visit.
create or replace function private.apply_catalog_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare v_price numeric(12,2); v_code text; v_name text; v_params jsonb;
begin
 if tg_op='UPDATE' then
  if new.price_snapshot is distinct from old.price_snapshot
   or new.technical_snapshot is distinct from old.technical_snapshot
   or new.test_code_snapshot is distinct from old.test_code_snapshot
   or new.test_name_snapshot is distinct from old.test_name_snapshot then
   raise exception 'Visit test price and technical snapshots are immutable';
  end if;
  return new;
 end if;
 select tc.code,tc.name into v_code,v_name from public.tests_catalog tc
  where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
 if v_code is null then raise exception 'Test is not active in this tenant catalog'; end if;
 select tp.selling_price into v_price from public.test_prices tp
  where tp.tenant_id=new.tenant_id and tp.test_id=new.test_id and tp.is_current
   and (tp.branch_id=new.branch_id or tp.branch_id is null)
  order by (tp.branch_id is not null) desc limit 1;
 if v_price is null then raise exception 'No active price configured for this test and branch'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',p.parameter_code,'name',p.parameter_name,'unit',p.unit,
  'value_type',p.value_type,'decimal_places',p.decimal_places,
  'reference_ranges',p.reference_ranges,'choices',p.choices,
  'display_order',p.display_order,'is_required',p.is_required,
  'result_source',p.result_source,'formula',p.formula
 ) order by p.display_order,p.parameter_code),'[]'::jsonb)
 into v_params from public.test_parameters p
 where p.tenant_id=new.tenant_id and p.test_id=new.test_id and p.is_active;
 if jsonb_array_length(v_params)=0 then raise exception 'Define at least one active parameter before ordering this test'; end if;
 new.price_snapshot:=v_price; new.test_code_snapshot:=v_code; new.test_name_snapshot:=v_name;
 new.technical_snapshot:=jsonb_build_object('parameters',v_params);
 return new;
end; $function$;

create or replace function public.save_draft_results_atomic(
  p_tenant_id uuid,p_branch_id uuid,p_visit_test_id uuid,p_staff_id uuid,p_results jsonb
)
returns setof public.test_results
language plpgsql
security definer
set search_path = pg_catalog,public,private
as $function$
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
        insert into public.test_results(tenant_id,visit_test_id,parameter_code,value_numeric,value_text,flag,entered_by,entered_by_staff_id)
        values(p_tenant_id,p_visit_test_id,v_code,v_formula,null,null,auth.uid(),p_staff_id)
        on conflict (visit_test_id,parameter_code) do update set
          value_numeric=excluded.value_numeric,value_text=null,flag=null,
          entered_by=excluded.entered_by,entered_by_staff_id=excluded.entered_by_staff_id,updated_at=now();
        v_values:=jsonb_set(v_values,array[v_code],to_jsonb(v_formula),true);
        v_pass:=v_pass+1;
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

revoke all on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;

comment on column public.test_parameters.result_source is 'manual = entered by staff; calculated = computed server-side from parameter formulas';
comment on column public.test_parameters.formula is 'Safe JSON formula AST; never executable SQL or JavaScript';
