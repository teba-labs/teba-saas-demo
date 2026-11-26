-- 119: Create an individual catalog test and its first result parameter atomically.
-- This prevents a failed default-parameter insert from leaving a half-created test.
begin;

create or replace function public.create_catalog_test_with_default_parameter(
  p_tenant_id uuid,
  p_test jsonb,
  p_parameter jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_test public.tests_catalog%rowtype;
  v_existing_test public.tests_catalog%rowtype;
  v_parameter public.test_parameters%rowtype;
  v_existing_parameter public.test_parameters%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or not private.is_tenant_member(p_tenant_id) then
    raise exception 'Tenant membership required' using errcode='42501';
  end if;
  if jsonb_typeof(p_test) <> 'object' or jsonb_typeof(p_parameter) <> 'object' then
    raise exception 'Test and initial parameter must be JSON objects' using errcode='22023';
  end if;

  v_test := jsonb_populate_record(null::public.tests_catalog, p_test);
  v_test.id := coalesce(v_test.id, gen_random_uuid());
  v_test.tenant_id := p_tenant_id;

  if v_test.test_kind <> 'individual' then
    raise exception 'Atomic initial-parameter creation is only for individual tests' using errcode='22023';
  end if;
  if nullif(btrim(v_test.code),'') is null or length(v_test.code)>40
     or nullif(btrim(v_test.name),'') is null or length(v_test.name)>160 then
    raise exception 'A valid test code and name are required' using errcode='22023';
  end if;

  select * into v_existing_test
    from public.tests_catalog
   where tenant_id=p_tenant_id and id=v_test.id
   for update;
  if found then
    if v_existing_test.code <> v_test.code then
      raise exception 'Catalog test idempotency key is already used by another test' using errcode='23505';
    end if;
    v_test := v_existing_test;
  else
    if exists(select 1 from public.tests_catalog where tenant_id=p_tenant_id and code=v_test.code) then
      raise exception 'كود التحليل مستخدم بالفعل داخل هذا المعمل.' using errcode='23505';
    end if;

    insert into public.tests_catalog(
      id,tenant_id,code,name,test_kind,category,specimen,method,turnaround_minutes,instructions,is_active,
      short_name,synonyms,loinc_code,clinical_category,clinical_purpose,service_type,
      patient_preparation,collection_requirements,specimen_requirements,transport_requirements,
      stability_requirements,rejection_criteria,biosafety_notes,critical_result_policy,
      reporting_notes,source_references,clinical_review_status
    ) values (
      v_test.id,p_tenant_id,v_test.code,v_test.name,v_test.test_kind,v_test.category,v_test.specimen,
      v_test.method,v_test.turnaround_minutes,v_test.instructions,coalesce(v_test.is_active,true),
      v_test.short_name,coalesce(v_test.synonyms,'{}'::text[]),v_test.loinc_code,
      v_test.clinical_category,v_test.clinical_purpose,coalesce(v_test.service_type,'laboratory_test'),
      coalesce(v_test.patient_preparation,'{}'::jsonb),coalesce(v_test.collection_requirements,'{}'::jsonb),
      coalesce(v_test.specimen_requirements,'{}'::jsonb),coalesce(v_test.transport_requirements,'{}'::jsonb),
      coalesce(v_test.stability_requirements,'{}'::jsonb),coalesce(v_test.rejection_criteria,'{}'::text[]),
      v_test.biosafety_notes,coalesce(v_test.critical_result_policy,'{}'::jsonb),
      v_test.reporting_notes,coalesce(v_test.source_references,'[]'::jsonb),
      coalesce(v_test.clinical_review_status,'needs_review')
    ) returning * into v_test;
  end if;

  v_parameter := jsonb_populate_record(null::public.test_parameters, p_parameter);
  v_parameter.id := coalesce(v_parameter.id, gen_random_uuid());
  v_parameter.tenant_id := p_tenant_id;
  v_parameter.test_id := v_test.id;

  if nullif(btrim(v_parameter.parameter_code),'') is null or length(v_parameter.parameter_code)>40
     or nullif(btrim(v_parameter.parameter_name),'') is null or length(v_parameter.parameter_name)>160 then
    raise exception 'A valid initial parameter code and name are required' using errcode='22023';
  end if;
  if v_parameter.value_type not in ('numeric','text','boolean','choice') then
    raise exception 'Unsupported parameter value type' using errcode='22023';
  end if;
  if v_parameter.result_source not in ('manual','calculated') then
    raise exception 'Unsupported parameter result source' using errcode='22023';
  end if;
  if v_parameter.result_source='calculated' and
     (v_parameter.formula is null or jsonb_typeof(v_parameter.formula)<>'object') then
    raise exception 'A calculated parameter requires a valid formula AST' using errcode='22023';
  end if;

  select * into v_existing_parameter
    from public.test_parameters
   where tenant_id=p_tenant_id and id=v_parameter.id
   for update;
  if found then
    if v_existing_parameter.test_id<>v_test.id
       or v_existing_parameter.parameter_code<>v_parameter.parameter_code then
      raise exception 'Initial parameter idempotency key is already used by another parameter' using errcode='23505';
    end if;
    v_parameter := v_existing_parameter;
  else
    if exists(
      select 1 from public.test_parameters
       where tenant_id=p_tenant_id and test_id=v_test.id
         and parameter_code=v_parameter.parameter_code
    ) then
      raise exception 'كود البارامتر مستخدم بالفعل داخل هذا التحليل.' using errcode='23505';
    end if;

    insert into public.test_parameters(
      id,tenant_id,test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
      reference_ranges,choices,display_order,is_required,is_active,result_source,formula,
      unit_ucum,alternate_units,critical_ranges,interpretation_rules,applicability,method_notes,
      clinical_metadata,source_references,clinical_review_status,reference_interval_status,
      result_input_mode,result_config,display_rules,formula_expression
    ) values (
      v_parameter.id,p_tenant_id,v_test.id,v_parameter.parameter_code,v_parameter.parameter_name,
      v_parameter.unit,coalesce(v_parameter.value_type,'numeric'),coalesce(v_parameter.decimal_places,2),
      coalesce(v_parameter.reference_ranges,'[]'::jsonb),coalesce(v_parameter.choices,'[]'::jsonb),
      coalesce(v_parameter.display_order,0),coalesce(v_parameter.is_required,true),coalesce(v_parameter.is_active,true),
      coalesce(v_parameter.result_source,'manual'),v_parameter.formula,v_parameter.unit_ucum,
      coalesce(v_parameter.alternate_units,'[]'::jsonb),coalesce(v_parameter.critical_ranges,'{}'::jsonb),
      coalesce(v_parameter.interpretation_rules,'[]'::jsonb),coalesce(v_parameter.applicability,'{}'::jsonb),
      v_parameter.method_notes,coalesce(v_parameter.clinical_metadata,'{}'::jsonb),
      coalesce(v_parameter.source_references,'[]'::jsonb),coalesce(v_parameter.clinical_review_status,'needs_review'),
      coalesce(v_parameter.reference_interval_status,'local_verification_required'),
      coalesce(v_parameter.result_input_mode,'numeric_decimal'),coalesce(v_parameter.result_config,'{}'::jsonb),
      coalesce(v_parameter.display_rules,'[]'::jsonb),v_parameter.formula_expression
    ) returning * into v_parameter;
  end if;

  return jsonb_build_object('test',to_jsonb(v_test),'parameter',to_jsonb(v_parameter));
end;
$function$;

revoke all on function public.create_catalog_test_with_default_parameter(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_catalog_test_with_default_parameter(uuid,jsonb,jsonb) to authenticated;

comment on function public.create_catalog_test_with_default_parameter(uuid,jsonb,jsonb) is
  'Creates an individual tenant catalog test and its first result parameter in one transaction. Client-generated IDs make retries idempotent; any validation or insert error rolls back both rows.';

commit;
