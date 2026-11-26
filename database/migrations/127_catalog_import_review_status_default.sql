-- 127: Ensure incomplete master catalog records receive a tenant review state on import.
-- The master table permits NULL review status; the tenant catalog does not.
-- Preserve all existing import logic and normalize only this NOT NULL boundary.
begin;
CREATE OR REPLACE FUNCTION public.import_master_catalog_test_unchecked(p_tenant_id uuid, p_master_test_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
  if not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Only the tenant owner may import master catalog tests';
  end if;

  select * into v_master from public.master_catalog_tests where id=p_master_test_id;
  if not found then raise exception 'Master catalog test was not found'; end if;

  select * into v_release from public.master_catalog_releases
   where id=v_master.release_id and status='published';
  if not found then raise exception 'Only tests in a published master release can be imported'; end if;

  select test_id into v_existing from public.tenant_catalog_master_links
   where tenant_id=p_tenant_id and master_test_id=p_master_test_id;
  if v_existing is not null then return v_existing; end if;

  if exists (
    select 1 from public.tests_catalog
     where tenant_id=p_tenant_id and code=v_master.master_code
  ) then
    raise exception 'A tenant test already uses master code %. Rename the existing test before importing.',v_master.master_code;
  end if;

  v_definition:=coalesce(v_master.definition,'{}'::jsonb);
  if v_master.test_kind='group' and
     (coalesce(jsonb_typeof(v_definition->'components'),'null') <> 'array'
      or jsonb_array_length(coalesce(v_definition->'components','[]'::jsonb))=0) then
    raise exception 'Master group must contain at least one component reference';
  end if;

  -- Preserve the existing published-catalog behavior: incomplete definitions may
  -- still be imported and remain visibly marked for local clinical review.
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
    v_definition->>'short_name',coalesce(array(select jsonb_array_elements_text(coalesce(v_master.alternate_names,'[]'::jsonb))),'{}'::text[]),
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
    coalesce(v_master.clinical_review_status,'needs_review'),v_release.version,
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
     set result_source=mp.result_source,
         formula=private.master_formula_text_to_jsonb(mp.formula),
         formula_expression=mp.formula_expression
    from public.master_catalog_parameters mp
   where tp.tenant_id=p_tenant_id and tp.test_id=v_test_id
     and mp.master_test_id=p_master_test_id and mp.parameter_code=tp.parameter_code
     and mp.result_source='calculated';

  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order,p.parameter_code),'[]'::jsonb)
    into v_parameters
    from public.test_parameters p
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
$function$

;
commit;
