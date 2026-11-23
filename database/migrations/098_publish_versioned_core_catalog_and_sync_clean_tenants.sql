-- 098: Publish an immutable core release and refresh only uncustomized tenant copies.
-- Historical visit snapshots are not modified. Tenant prices and activation state are preserved.
begin;

do $block$
declare
  v_old_release uuid;
  v_new_release uuid;
  v_version text := 'taiba-core-2026.11.23-r1';
begin
  select id into v_old_release from public.master_catalog_releases
   where version='taiba-core-2026.11.20-r1' and status='published';
  if v_old_release is null then
    raise exception 'Expected source core release taiba-core-2026.11.20-r1 was not found';
  end if;
  if exists(select 1 from public.master_catalog_releases where version=v_version) then
    raise exception 'Target core release % already exists; refusing duplicate release creation',v_version;
  end if;

  insert into public.master_catalog_releases(version,title,description,status,published_at)
  values(
    v_version,
    'Taiba Core Medical Catalog — 23 Nov 2026',
    'Versioned source-backed core catalog: 45 clinically reviewed test profiles and 352 structured parameters. Method-specific external reference intervals remain flagged for tenant verification.',
    'published',
    now()
  ) returning id into v_new_release;

  create temporary table _taiba_master_release_map(
    old_master_test_id uuid primary key,
    new_master_test_id uuid not null unique
  ) on commit drop;

  with inserted as (
    insert into public.master_catalog_tests(
      release_id,master_code,canonical_name,alternate_names,test_kind,category,
      service_type,definition,clinical_review_status,source_name,legacy_snapshot
    )
    select v_new_release,t.master_code,t.canonical_name,t.alternate_names,t.test_kind,t.category,
      t.service_type,t.definition,t.clinical_review_status,t.source_name,t.legacy_snapshot
    from public.master_catalog_tests t
    where t.release_id=v_old_release
    returning id,master_code
  )
  insert into _taiba_master_release_map(old_master_test_id,new_master_test_id)
  select old.id,inserted.id
    from public.master_catalog_tests old
    join inserted on inserted.master_code=old.master_code
   where old.release_id=v_old_release;

  insert into public.master_catalog_parameters(
    master_test_id,parameter_code,parameter_name,unit,unit_ucum,value_type,decimal_places,
    reference_ranges,critical_ranges,choices,applicability,interpretation_rules,display_order,
    is_required,result_source,formula,clinical_metadata,source_references,clinical_review_status,
    alternate_units,reference_interval_status,legacy_snapshot,result_input_mode,result_config,
    display_rules,formula_expression
  )
  select map.new_master_test_id,p.parameter_code,p.parameter_name,p.unit,p.unit_ucum,p.value_type,p.decimal_places,
    p.reference_ranges,p.critical_ranges,p.choices,p.applicability,p.interpretation_rules,p.display_order,
    p.is_required,p.result_source,p.formula,p.clinical_metadata,p.source_references,p.clinical_review_status,
    p.alternate_units,p.reference_interval_status,p.legacy_snapshot,p.result_input_mode,p.result_config,
    p.display_rules,p.formula_expression
  from public.master_catalog_parameters p
  join _taiba_master_release_map map on map.old_master_test_id=p.master_test_id;

  -- Refresh only tenant-owned copies with no tracked local customization.
  -- Preserve test activation, current price history, and all visit snapshots.
  update public.tests_catalog tc
     set code=m.master_code,
         name=m.canonical_name,
         test_kind=m.test_kind,
         category=coalesce(m.category,m.definition->>'category'),
         specimen=m.definition->>'specimen',
         method=m.definition->>'method',
         turnaround_minutes=nullif(m.definition->>'turnaround_minutes','')::integer,
         instructions=m.definition->>'instructions',
         short_name=m.definition->>'short_name',
         synonyms=coalesce(m.alternate_names,'{}'),
         loinc_code=m.definition->>'loinc_code',
         clinical_category=m.definition->>'clinical_category',
         clinical_purpose=m.definition->>'clinical_purpose',
         service_type=m.service_type,
         patient_preparation=coalesce(m.definition->'patient_preparation','{}'::jsonb),
         collection_requirements=coalesce(m.definition->'collection_requirements','{}'::jsonb),
         specimen_requirements=coalesce(m.definition->'specimen_requirements','{}'::jsonb),
         transport_requirements=coalesce(m.definition->'transport_requirements','{}'::jsonb),
         stability_requirements=coalesce(m.definition->'stability_requirements','{}'::jsonb),
         rejection_criteria=coalesce(array(select jsonb_array_elements_text(coalesce(m.definition->'rejection_criteria','[]'::jsonb))),'{}'),
         biosafety_notes=m.definition->>'biosafety_notes',
         critical_result_policy=coalesce(m.definition->'critical_result_policy','{}'::jsonb),
         reporting_notes=m.definition->>'reporting_notes',
         source_references=coalesce(m.definition->'source_references','[]'::jsonb),
         clinical_review_status=m.clinical_review_status,
         catalog_version=v_version
    from public.tenant_catalog_master_links l
    join _taiba_master_release_map map on map.old_master_test_id=l.master_test_id
    join public.master_catalog_tests m on m.id=map.new_master_test_id
   where tc.id=l.test_id and tc.tenant_id=l.tenant_id
     and coalesce(cardinality(l.customization_fields),0)=0;

  update public.test_parameters tp
     set parameter_name=mp.parameter_name,
         unit=mp.unit,
         value_type=mp.value_type,
         decimal_places=mp.decimal_places,
         reference_ranges=mp.reference_ranges,
         choices=mp.choices,
         display_order=mp.display_order,
         is_required=mp.is_required,
         result_source=mp.result_source,
         formula=mp.formula,
         unit_ucum=mp.unit_ucum,
         alternate_units=mp.alternate_units,
         critical_ranges=mp.critical_ranges,
         interpretation_rules=mp.interpretation_rules,
         applicability=mp.applicability,
         method_notes=mp.clinical_metadata->>'method_notes',
         clinical_metadata=mp.clinical_metadata,
         source_references=mp.source_references,
         clinical_review_status=mp.clinical_review_status,
         reference_interval_status=mp.reference_interval_status,
         result_input_mode=mp.result_input_mode,
         result_config=mp.result_config,
         display_rules=mp.display_rules,
         formula_expression=mp.formula_expression
    from public.tenant_catalog_master_links l
    join _taiba_master_release_map map on map.old_master_test_id=l.master_test_id
    join public.master_catalog_parameters mp on mp.master_test_id=map.new_master_test_id
   where tp.tenant_id=l.tenant_id and tp.test_id=l.test_id
     and tp.parameter_code=mp.parameter_code
     and coalesce(cardinality(l.customization_fields),0)=0;

  insert into public.test_parameters(
    tenant_id,test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
    reference_ranges,choices,display_order,is_required,is_active,result_source,formula,
    unit_ucum,alternate_units,critical_ranges,interpretation_rules,applicability,method_notes,
    clinical_metadata,source_references,clinical_review_status,reference_interval_status,
    result_input_mode,result_config,display_rules,formula_expression
  )
  select l.tenant_id,l.test_id,mp.parameter_code,mp.parameter_name,mp.unit,mp.value_type,mp.decimal_places,
    mp.reference_ranges,mp.choices,mp.display_order,mp.is_required,true,mp.result_source,mp.formula,
    mp.unit_ucum,mp.alternate_units,mp.critical_ranges,mp.interpretation_rules,mp.applicability,
    mp.clinical_metadata->>'method_notes',mp.clinical_metadata,mp.source_references,mp.clinical_review_status,
    mp.reference_interval_status,mp.result_input_mode,mp.result_config,mp.display_rules,mp.formula_expression
  from public.tenant_catalog_master_links l
  join _taiba_master_release_map map on map.old_master_test_id=l.master_test_id
  join public.master_catalog_parameters mp on mp.master_test_id=map.new_master_test_id
  where coalesce(cardinality(l.customization_fields),0)=0
    and not exists(select 1 from public.test_parameters tp where tp.tenant_id=l.tenant_id and tp.test_id=l.test_id and tp.parameter_code=mp.parameter_code);

  delete from public.test_parameters tp
   using public.tenant_catalog_master_links l,_taiba_master_release_map map
   where l.master_test_id=map.old_master_test_id
     and tp.tenant_id=l.tenant_id and tp.test_id=l.test_id
     and coalesce(cardinality(l.customization_fields),0)=0
     and not exists(select 1 from public.master_catalog_parameters mp where mp.master_test_id=map.new_master_test_id and mp.parameter_code=tp.parameter_code);

  -- Advance clean links and snapshot the refreshed tenant-owned copy.
  update public.tenant_catalog_master_links l
     set master_test_id=map.new_master_test_id,
         imported_release_id=v_new_release,
         last_applied_version=v_version,
         sync_status='current',
         baseline_snapshot=jsonb_build_object(
           'test',(select to_jsonb(tc) from public.tests_catalog tc where tc.id=l.test_id and tc.tenant_id=l.tenant_id),
           'parameters',(select coalesce(jsonb_agg(to_jsonb(tp) order by tp.display_order,tp.parameter_code),'[]'::jsonb)
                           from public.test_parameters tp where tp.test_id=l.test_id and tp.tenant_id=l.tenant_id)
         )
    from _taiba_master_release_map map
   where l.master_test_id=map.old_master_test_id
     and coalesce(cardinality(l.customization_fields),0)=0;

  -- Customized copies stay untouched and are explicitly marked as having an update available.
  update public.tenant_catalog_master_links l
     set sync_status='update_available'
    from _taiba_master_release_map map
   where l.master_test_id=map.old_master_test_id
     and coalesce(cardinality(l.customization_fields),0)>0;

  update public.master_catalog_releases set status='archived'
   where id=v_old_release;
end;
$block$;

commit;
