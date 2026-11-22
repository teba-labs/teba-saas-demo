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
     (jsonb_typeof(v_definition->'components') <> 'array' or jsonb_array_length(v_definition->'components')=0) then
    raise exception 'Master group must contain at least one component reference';
  end if;
  if v_master.test_kind<>'group' and not exists(
    select 1 from public.master_catalog_parameters where master_test_id=p_master_test_id
  ) then
    raise exception 'Master catalog test has no result parameters';
  end if;

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
    method_notes,clinical_metadata,source_references,clinical_review_status,
    result_input_mode,result_config,display_rules,formula_expression
  )
  select p_tenant_id,v_test_id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,
    p.reference_ranges,p.choices,p.display_order,p.is_required,true,'manual',null,
    p.unit_ucum,p.alternate_units,p.critical_ranges,p.interpretation_rules,p.applicability,
    p.clinical_metadata->>'method_notes',p.clinical_metadata,p.source_references,p.clinical_review_status,
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

commit;
