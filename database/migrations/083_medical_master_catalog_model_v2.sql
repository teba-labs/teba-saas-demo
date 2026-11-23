-- 083: Re-shape the existing medical master catalog for doctor-friendly result definitions.
-- No new catalog tables are created. Original master rows are snapshotted in-place before normalization.
begin;

-- Preserve every original master row exactly once before changing its representation.
alter table public.master_catalog_tests
  add column if not exists legacy_snapshot jsonb;
alter table public.master_catalog_parameters
  add column if not exists legacy_snapshot jsonb;

update public.master_catalog_tests
   set legacy_snapshot = to_jsonb(t)
  from public.master_catalog_tests t
 where public.master_catalog_tests.id = t.id
   and public.master_catalog_tests.legacy_snapshot is null;

update public.master_catalog_parameters
   set legacy_snapshot = to_jsonb(p)
  from public.master_catalog_parameters p
 where public.master_catalog_parameters.id = p.id
   and public.master_catalog_parameters.legacy_snapshot is null;

-- Doctor-facing result configuration remains on the existing parameter rows.
alter table public.master_catalog_parameters
  add column if not exists result_input_mode text not null default 'numeric_decimal',
  add column if not exists result_config jsonb not null default '{}'::jsonb,
  add column if not exists display_rules jsonb not null default '[]'::jsonb,
  add column if not exists formula_expression text;

-- Tenant copies receive the same fields so imports do not lose the master definition.
alter table public.test_parameters
  add column if not exists result_input_mode text not null default 'numeric_decimal',
  add column if not exists result_config jsonb not null default '{}'::jsonb,
  add column if not exists display_rules jsonb not null default '[]'::jsonb,
  add column if not exists formula_expression text;

-- Group composition is stored on the existing test row; no junction table is introduced.
alter table public.tests_catalog
  add column if not exists components jsonb not null default '[]'::jsonb;

-- Existing test kind now distinguishes individual, profile/panel, and collection/group.
alter table public.master_catalog_tests
  drop constraint if exists master_catalog_tests_test_kind_check;
alter table public.master_catalog_tests
  add constraint master_catalog_tests_test_kind_check
  check (test_kind in ('individual','panel','group'));

alter table public.tests_catalog
  drop constraint if exists tests_catalog_test_kind_check;
alter table public.tests_catalog
  add constraint tests_catalog_test_kind_check
  check (test_kind in ('individual','panel','group'));

-- Keep the legacy value_type contract for compatibility; result_input_mode describes
-- the exact control shown to the doctor and does not break existing result validators.
alter table public.master_catalog_parameters
  drop constraint if exists master_catalog_parameters_result_input_mode_check;
alter table public.master_catalog_parameters
  add constraint master_catalog_parameters_result_input_mode_check
  check (result_input_mode in (
    'numeric_integer','numeric_decimal','numeric_comparator',
    'text','positive_negative','boolean','single_choice',
    'multi_choice','graded_multi_choice'
  ));

alter table public.test_parameters
  drop constraint if exists test_parameters_result_input_mode_check;
alter table public.test_parameters
  add constraint test_parameters_result_input_mode_check
  check (result_input_mode in (
    'numeric_integer','numeric_decimal','numeric_comparator',
    'text','positive_negative','boolean','single_choice',
    'multi_choice','graded_multi_choice'
  ));

alter table public.master_catalog_parameters
  drop constraint if exists master_catalog_parameters_result_config_object_check;
alter table public.master_catalog_parameters
  add constraint master_catalog_parameters_result_config_object_check
  check (jsonb_typeof(result_config) = 'object');

alter table public.master_catalog_parameters
  drop constraint if exists master_catalog_parameters_display_rules_array_check;
alter table public.master_catalog_parameters
  add constraint master_catalog_parameters_display_rules_array_check
  check (jsonb_typeof(display_rules) = 'array');

alter table public.test_parameters
  drop constraint if exists test_parameters_result_config_object_check;
alter table public.test_parameters
  add constraint test_parameters_result_config_object_check
  check (jsonb_typeof(result_config) = 'object');

alter table public.test_parameters
  drop constraint if exists test_parameters_display_rules_array_check;
alter table public.test_parameters
  add constraint test_parameters_display_rules_array_check
  check (jsonb_typeof(display_rules) = 'array');

-- Convert the existing JSON formula AST to readable doctor-editable text.
create or replace function private.master_formula_to_expression(p_node jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_op text;
  v_args jsonb;
  v_left text;
  v_right text;
  v_parts text[];
  v_item jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' then return null; end if;
  if p_node ? 'param' then return p_node->>'param'; end if;
  if p_node ? 'const' then return p_node->>'const'; end if;
  v_op := p_node->>'op';
  v_args := p_node->'args';
  if jsonb_typeof(v_args) <> 'array' then return null; end if;
  if v_op in ('add','subtract','multiply','divide') and jsonb_array_length(v_args)=2 then
    v_left := private.master_formula_to_expression(v_args->0);
    v_right := private.master_formula_to_expression(v_args->1);
    return '(' || v_left || ' ' ||
      case v_op when 'add' then '+' when 'subtract' then '-' when 'multiply' then '*' else '/' end ||
      ' ' || v_right || ')';
  end if;
  if v_op in ('abs','round','min','max') then
    for v_item in select value from jsonb_array_elements(v_args) loop
      v_parts := array_append(v_parts, private.master_formula_to_expression(v_item));
    end loop;
    return v_op || '(' || array_to_string(v_parts, ', ') || ')';
  end if;
  return null;
end;
$function$;

update public.master_catalog_parameters
   set formula_expression = private.master_formula_to_expression(formula)
 where formula is not null
   and coalesce(formula_expression,'') = '';

-- Derive safe input controls from existing data without guessing any clinical meaning.
update public.master_catalog_parameters
   set result_input_mode = case
     when value_type='numeric' and decimal_places=0 then 'numeric_integer'
     when value_type='numeric' then 'numeric_decimal'
     when value_type='text' then 'text'
     when value_type='boolean' then 'boolean'
     when value_type='choice' then 'single_choice'
     else 'text'
   end;

update public.test_parameters
   set result_input_mode = case
     when value_type='numeric' and decimal_places=0 then 'numeric_integer'
     when value_type='numeric' then 'numeric_decimal'
     when value_type='text' then 'text'
     when value_type='boolean' then 'boolean'
     when value_type='choice' then 'single_choice'
     else 'text'
   end;

update public.test_parameters tp
   set formula_expression = private.master_formula_to_expression(mp.formula),
       result_input_mode = mp.result_input_mode,
       result_config = mp.result_config,
       display_rules = mp.display_rules
  from public.master_catalog_parameters mp
  join public.tenant_catalog_master_links l on l.master_test_id=mp.master_test_id
 where l.test_id=tp.test_id
   and l.tenant_id=tp.tenant_id
   and tp.parameter_code=mp.parameter_code
   and (mp.formula is not null or mp.result_input_mode is not null);

-- Reference intervals are always arrays after this migration. The previous shape is
-- retained in legacy_snapshot, including the four text-only stool microscopy entries.
with shaped as (
  select id,
         case
           when jsonb_typeof(reference_ranges)='array' then reference_ranges
           when jsonb_typeof(reference_ranges)='object' then jsonb_build_array(reference_ranges)
           else '[]'::jsonb
         end as ranges
    from public.master_catalog_parameters
)
update public.master_catalog_parameters p
   set reference_ranges = (
     select coalesce(jsonb_agg(
       case
         when jsonb_typeof(item->'age')='object' then
           jsonb_set(item,'{age}',
             (item->'age') || jsonb_build_object(
               'min_unit',coalesce(item->'age'->>'min_unit',item->'age'->>'unit','years'),
               'max_unit',coalesce(item->'age'->>'max_unit',item->'age'->>'unit','years')
             ),true)
         else item
       end
     ),'[]'::jsonb)
       from jsonb_array_elements(shaped.ranges) item
   )
  from shaped
 where shaped.id=p.id;

-- Keep component definitions inside definition JSONB on the master test itself.
update public.master_catalog_tests
   set definition = jsonb_set(coalesce(definition,'{}'::jsonb),'{components}',
     coalesce(definition->'components','[]'::jsonb),true)
 where test_kind='group'
   and (definition->'components' is null or jsonb_typeof(definition->'components')='array');

comment on column public.master_catalog_tests.definition is
  'Doctor-facing test definition. For group tests, definition.components is an ordered array of master_code references; no duplicated test definitions.';
comment on column public.master_catalog_parameters.result_input_mode is
  'Doctor-facing input control: integer/decimal/comparator numeric, text, positive-negative, boolean, single/multiple/graded choices.';
comment on column public.master_catalog_parameters.result_config is
  'Structured choices and grading configuration; choices remain editable and may be conditional on another parameter.';
comment on column public.master_catalog_parameters.display_rules is
  'Conditional visibility rules referencing another parameter in the same test, e.g. pH controls available crystal choices.';
comment on column public.master_catalog_parameters.formula_expression is
  'Human-readable arithmetic expression. formula JSONB remains the validated execution AST.';
comment on column public.master_catalog_parameters.legacy_snapshot is
  'Immutable pre-v2 row snapshot retained for rollback and audit before catalog normalization.';
comment on column public.tests_catalog.components is
  'Imported master group component references; expanded by the order-entry workflow without duplicating test definitions.';

-- Import the new fields into tenant-owned copies while preserving the existing owner-only
-- import contract, formula AST, baseline snapshot and tenant customization isolation.
create or replace function public.import_master_catalog_test(
  p_tenant_id uuid,
  p_master_test_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_master public.master_catalog_tests%rowtype;
  v_release public.master_catalog_releases%rowtype;
  v_test_id uuid;
  v_existing uuid;
  v_definition jsonb;
  v_parameters jsonb;
  v_parameter_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the tenant owner may import master catalog tests'; end if;

  select * into v_master from public.master_catalog_tests where id=p_master_test_id;
  if not found then raise exception 'Master catalog test was not found'; end if;
  select * into v_release from public.master_catalog_releases
   where id=v_master.release_id and status='published';
  if not found then raise exception 'Only tests in a published master release can be imported'; end if;

  select test_id into v_existing from public.tenant_catalog_master_links
   where tenant_id=p_tenant_id and master_test_id=p_master_test_id;
  if v_existing is not null then return v_existing; end if;
  if exists(select 1 from public.tests_catalog where tenant_id=p_tenant_id and code=v_master.master_code) then
    raise exception 'A tenant test already uses master code %. Rename the existing test before importing.',v_master.master_code;
  end if;

  v_definition:=coalesce(v_master.definition,'{}'::jsonb);
  if v_master.test_kind='group' and
     (coalesce(jsonb_typeof(v_definition->'components'),'null') <> 'array'
      or jsonb_array_length(coalesce(v_definition->'components','[]'::jsonb))=0) then
    raise exception 'Master group must contain at least one component reference';
  end if;
  -- Keep migration 078 behavior: published definitions may be imported even before
  -- their parameter set is complete. Incomplete definitions remain visibly unreviewed.
  insert into public.tests_catalog(
    tenant_id,code,name,test_kind,category,specimen,method,turnaround_minutes,instructions,is_active,
    short_name,synonyms,loinc_code,clinical_category,clinical_purpose,service_type,
    patient_preparation,collection_requirements,specimen_requirements,transport_requirements,
    stability_requirements,rejection_criteria,biosafety_notes,critical_result_policy,
    reporting_notes,source_references,clinical_review_status,catalog_version,components
  ) values (
    p_tenant_id,v_master.master_code,v_master.canonical_name,v_master.test_kind,
    coalesce(v_master.category,v_definition->>'category'),
    v_definition->>'specimen',v_definition->>'method',
    nullif(v_definition->>'turnaround_minutes','')::integer,v_definition->>'instructions',true,
    v_definition->>'short_name',coalesce(v_master.alternate_names,'{}'),
    v_definition->>'loinc_code',v_definition->>'clinical_category',v_definition->>'clinical_purpose',
    coalesce(v_master.service_type,'laboratory_test'),
    coalesce(v_definition->'patient_preparation','{}'::jsonb),
    coalesce(v_definition->'collection_requirements','{}'::jsonb),
    coalesce(v_definition->'specimen_requirements','{}'::jsonb),
    coalesce(v_definition->'transport_requirements','{}'::jsonb),
    coalesce(v_definition->'stability_requirements','{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(v_definition->'rejection_criteria','[]'::jsonb))),'{}'),
    v_definition->>'biosafety_notes',
    coalesce(v_definition->'critical_result_policy','{}'::jsonb),
    v_definition->>'reporting_notes',
    coalesce(v_definition->'source_references','[]'::jsonb),
    v_master.clinical_review_status,v_release.version,
    coalesce(v_definition->'components','[]'::jsonb)
  ) returning id into v_test_id;

  insert into public.test_parameters(
    tenant_id,test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
    reference_ranges,choices,display_order,is_required,is_active,result_source,formula,
    unit_ucum,alternate_units,critical_ranges,interpretation_rules,applicability,
    method_notes,clinical_metadata,source_references,clinical_review_status,reference_interval_status,
    result_input_mode,result_config,display_rules,formula_expression
  )
  select p_tenant_id,v_test_id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,
    p.reference_ranges,p.choices,p.display_order,p.is_required,true,'manual',null,
    p.unit_ucum,p.alternate_units,p.critical_ranges,p.interpretation_rules,p.applicability,
    p.clinical_metadata->>'method_notes',p.clinical_metadata,p.source_references,p.clinical_review_status,p.reference_interval_status,
    p.result_input_mode,p.result_config,p.display_rules,p.formula_expression
  from public.master_catalog_parameters p
  where p.master_test_id=p_master_test_id
  order by p.display_order,p.parameter_code;
  get diagnostics v_parameter_count=row_count;

  update public.test_parameters tp
     set result_source=mp.result_source, formula=mp.formula,
         formula_expression=mp.formula_expression
    from public.master_catalog_parameters mp
   where tp.tenant_id=p_tenant_id and tp.test_id=v_test_id
     and mp.master_test_id=p_master_test_id and mp.parameter_code=tp.parameter_code
     and mp.result_source='calculated';

  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order,p.parameter_code),'[]'::jsonb)
    into v_parameters from public.test_parameters p
   where p.tenant_id=p_tenant_id and p.test_id=v_test_id;

  insert into public.tenant_catalog_master_links(
    tenant_id,test_id,master_test_id,imported_release_id,last_applied_version,
    baseline_snapshot,customization_fields,sync_status
  ) values (
    p_tenant_id,v_test_id,p_master_test_id,v_release.id,v_release.version,
    jsonb_build_object('test',(select to_jsonb(t) from public.tests_catalog t where t.id=v_test_id),
                       'parameters',v_parameters),
    '{}','current'
  );
  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid,uuid) from public,anon;
grant execute on function public.import_master_catalog_test(uuid,uuid) to authenticated;

-- New visit snapshots must carry every clinician-facing input rule. This keeps the
-- result-entry page independent of later catalog edits and prevents live catalog drift.
create or replace function private.apply_catalog_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_price numeric(12,2);
  v_code text;
  v_name text;
  v_params jsonb;
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

  select tc.code,tc.name into v_code,v_name
    from public.tests_catalog tc
   where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
  if v_code is null then raise exception 'Test is not active in this tenant catalog'; end if;

  select tp.selling_price into v_price
    from public.test_prices tp
   where tp.tenant_id=new.tenant_id and tp.test_id=new.test_id and tp.is_current
     and (tp.branch_id=new.branch_id or tp.branch_id is null)
   order by (tp.branch_id is not null) desc limit 1;
  if v_price is null then raise exception 'No active price configured for this test and branch'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code',p.parameter_code,'name',p.parameter_name,'unit',p.unit,
    'value_type',p.value_type,'decimal_places',p.decimal_places,
    'reference_ranges',p.reference_ranges,'choices',p.choices,
    'display_order',p.display_order,'is_required',p.is_required,
    'result_source',p.result_source,'formula',p.formula,
    'result_input_mode',p.result_input_mode,
    'result_config',p.result_config,
    'display_rules',p.display_rules,
    'formula_expression',p.formula_expression,
    'reference_interval_status',p.reference_interval_status,
    'critical_ranges',p.critical_ranges,
    'clinical_metadata',p.clinical_metadata
  ) order by p.display_order,p.parameter_code),'[]'::jsonb)
    into v_params
    from public.test_parameters p
   where p.tenant_id=new.tenant_id and p.test_id=new.test_id and p.is_active;

  if jsonb_array_length(v_params)=0 then
    raise exception 'Define at least one active parameter before ordering this test';
  end if;

  new.price_snapshot:=v_price;
  new.test_code_snapshot:=v_code;
  new.test_name_snapshot:=v_name;
  new.technical_snapshot:=jsonb_build_object('parameters',v_params);
  return new;
end;
$function$;

-- Visit snapshots retain the group definition so a later catalog edit cannot rewrite history.
create or replace function private.add_catalog_kind_to_visit_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_kind text;
  v_components jsonb;
begin
  if tg_op <> 'INSERT' then return new; end if;
  select tc.test_kind,tc.components into v_kind,v_components
    from public.tests_catalog tc
   where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
  if v_kind is null then
    raise exception 'Active catalog test is required before creating a visit test';
  end if;
  new.technical_snapshot := jsonb_set(
    coalesce(new.technical_snapshot,'{}'::jsonb),'{test_kind}',to_jsonb(v_kind),true
  );
  if v_kind='group' then
    new.technical_snapshot := jsonb_set(
      new.technical_snapshot,'{components}',coalesce(v_components,'[]'::jsonb),true
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.add_catalog_kind_to_visit_snapshot() from public,anon,authenticated;


-- A conditional field is visible only when all configured rules match the selected
-- source parameter. Pending values are considered before saved values in the same batch.
create or replace function private.result_parameter_is_visible(
  p_tenant_id uuid,
  p_visit_test_id uuid,
  p_rules jsonb,
  p_pending_results jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rule jsonb;
  v_source text;
  v_expected text;
  v_actual text;
  v_operator text;
begin
  if p_rules is null then return true; end if;
  if jsonb_typeof(p_rules) <> 'array' then return false; end if;
  if jsonb_array_length(p_rules)=0 then return true; end if;
  if jsonb_typeof(p_pending_results) <> 'array' then return false; end if;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    v_source := nullif(btrim(v_rule->>'source_parameter_code'),'');
    v_expected := coalesce(v_rule->>'value','');
    v_operator := coalesce(v_rule->>'operator','equals');
    if v_source is null then return false; end if;

    select coalesce(x.value_text,x.value_numeric::text) into v_actual
      from jsonb_to_recordset(p_pending_results) as x(parameter_code text,value_numeric numeric,value_text text)
     where x.parameter_code=v_source
     limit 1;
    if v_actual is null then
      select coalesce(tr.value_text,tr.value_numeric::text) into v_actual
        from public.test_results tr
       where tr.tenant_id=p_tenant_id
         and tr.visit_test_id=p_visit_test_id
         and tr.parameter_code=v_source
       limit 1;
    end if;

    if v_operator='equals' then
      if v_actual is distinct from v_expected then return false; end if;
    elsif v_operator='not_equals' then
      if v_actual is null or v_actual=v_expected then return false; end if;
    elsif v_operator='is_not_empty' then
      if nullif(btrim(coalesce(v_actual,'')),'') is null then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$function$;
revoke all on function private.result_parameter_is_visible(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create or replace function private.result_value_matches_input_mode(
  p_input_mode text,
  p_value_type text,
  p_choices jsonb,
  p_result_config jsonb,
  p_numeric numeric,
  p_text text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_mode text := coalesce(p_input_mode,
    case p_value_type when 'numeric' then 'numeric_decimal'
      when 'boolean' then 'boolean' when 'choice' then 'single_choice' else 'text' end);
  v_payload jsonb;
  v_selected jsonb;
  v_option text;
  v_expected_score numeric := 0;
begin
  if p_text is null and p_numeric is null then return false; end if;
  if v_mode='numeric_integer' then return p_numeric is not null and p_numeric=trunc(p_numeric) and p_text is null; end if;
  if v_mode='numeric_decimal' then return p_numeric is not null and p_text is null; end if;
  if v_mode='numeric_comparator' then
    return p_numeric is null and p_text ~ '^(<=|>=|<|>|≤|≥)\s*-?(\d+(\.\d+)?|\.\d+)
;
  end if;
  if p_numeric is not null then return false; end if;
  if v_mode='text' then return p_text is not null; end if;
  if v_mode='positive_negative' then
    return lower(p_text) in ('positive','negative','equivocal','trace','weak positive','weak negative')
      or coalesce(p_choices,'[]'::jsonb) @> jsonb_build_array(p_text);
  end if;
  if v_mode='boolean' then return lower(p_text) in ('true','false'); end if;
  if v_mode='single_choice' then return coalesce(p_choices,'[]'::jsonb) @> jsonb_build_array(p_text); end if;

  if v_mode in ('multi_choice','graded_multi_choice') then
    begin
      v_payload := p_text::jsonb;
    exception when others then
      return false;
    end;
    if jsonb_typeof(v_payload)='array' then
      v_selected := v_payload;
    elsif jsonb_typeof(v_payload)='object' and jsonb_typeof(v_payload->'selected')='array' then
      v_selected := v_payload->'selected';
    else
      return false;
    end if;
    if jsonb_array_length(v_selected)=0 then return false; end if;
    if jsonb_array_length(v_selected) <>
       (select count(distinct value) from jsonb_array_elements_text(v_selected) as selected(value)) then
      return false;
    end if;
    for v_option in select jsonb_array_elements_text(v_selected) loop
      if not coalesce(p_choices,'[]'::jsonb) @> jsonb_build_array(v_option) then return false; end if;
      if v_mode='graded_multi_choice' then
        if coalesce(jsonb_typeof(p_result_config->'choice_scores'->v_option),'null') <> 'number' then return false; end if;
        v_expected_score := v_expected_score + (p_result_config->'choice_scores'->>v_option)::numeric;
      end if;
    end loop;
    if v_mode='graded_multi_choice' then
      if coalesce(jsonb_typeof(v_payload->'score'),'null') <> 'number' then return false; end if;
      if (v_payload->>'score')::numeric <> v_expected_score then return false; end if;
    end if;
    return true;
  end if;
  return false;
end;
$function$;
revoke all on function private.result_value_matches_input_mode(text,text,jsonb,jsonb,numeric,text) from public,anon,authenticated;

create or replace function private.result_parameter_value_matches_display_rules(
  p_tenant_id uuid,
  p_visit_test_id uuid,
  p_rules jsonb,
  p_pending_results jsonb,
  p_value_numeric numeric,
  p_value_text text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rule jsonb;
  v_source text;
  v_expected text;
  v_actual text;
  v_operator text;
  v_condition_met boolean;
  v_selected jsonb;
  v_candidate text;
begin
  if p_rules is null then return true; end if;
  if jsonb_typeof(p_rules) <> 'array' then return false; end if;
  if jsonb_array_length(p_rules)=0 then return true; end if;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if coalesce(jsonb_typeof(v_rule->'choices'),'null') <> 'array' then continue; end if;
    if jsonb_array_length(v_rule->'choices')=0 then continue; end if;
    v_source := nullif(btrim(v_rule->>'source_parameter_code'),'');
    v_expected := coalesce(v_rule->>'value','');
    v_operator := coalesce(v_rule->>'operator','equals');
    if v_source is null then return false; end if;

    select coalesce(x.value_text,x.value_numeric::text) into v_actual
      from jsonb_to_recordset(coalesce(p_pending_results,'[]'::jsonb))
           as x(parameter_code text,value_numeric numeric,value_text text)
     where x.parameter_code=v_source
     limit 1;
    if v_actual is null then
      select coalesce(tr.value_text,tr.value_numeric::text) into v_actual
        from public.test_results tr
       where tr.tenant_id=p_tenant_id and tr.visit_test_id=p_visit_test_id
         and tr.parameter_code=v_source
       limit 1;
    end if;

    v_condition_met := case
      when v_operator='equals' then v_actual is not distinct from v_expected
      when v_operator='not_equals' then v_actual is not null and v_actual<>v_expected
      when v_operator='is_not_empty' then nullif(btrim(coalesce(v_actual,'')),'') is not null
      else false
    end;
    if not v_condition_met then continue; end if;
    if p_value_text is null then return false; end if;

    begin
      if left(btrim(p_value_text),1) in ('[','{') then
        v_selected := p_value_text::jsonb;
        if jsonb_typeof(v_selected)='object' then v_selected:=v_selected->'selected'; end if;
        if jsonb_typeof(v_selected)<>'array' then return false; end if;
      else
        v_selected := jsonb_build_array(p_value_text);
      end if;
    exception when others then
      return false;
    end;

    for v_candidate in select jsonb_array_elements_text(v_selected) loop
      if not (v_rule->'choices' @> jsonb_build_array(v_candidate)) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$function$;
revoke all on function private.result_parameter_value_matches_display_rules(uuid,uuid,jsonb,jsonb,numeric,text) from public,anon,authenticated;


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
$function$


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
$function$


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
$function$


commit;
