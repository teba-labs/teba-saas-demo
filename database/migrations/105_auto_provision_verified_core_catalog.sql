-- 105: Provision the clinically reviewed core catalog automatically for each tenant.
-- The bootstrap is idempotent: it adds only missing tenant copies, never overwrites
-- existing tenant edits, prices, branch overrides, or explicit deactivations.
begin;

create or replace function public.ensure_tenant_core_catalog(p_tenant_id uuid)
returns table(installed_count integer, available_count integer, catalog_version text)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_release public.master_catalog_releases%rowtype;
  v_master public.master_catalog_tests%rowtype;
  v_test_id uuid;
  v_existing uuid;
  v_parameters jsonb;
  v_added integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if not private.is_tenant_member(p_tenant_id) then
    raise exception 'Tenant membership required' using errcode='42501';
  end if;

  select * into v_release
    from public.master_catalog_releases
   where status = 'published'
     and version like 'taiba-core-%'
   order by published_at desc nulls last, created_at desc
   limit 1;

  if not found then
    return query select 0, 0, null::text;
    return;
  end if;

  select count(*)::integer into v_total
    from public.master_catalog_tests
   where release_id = v_release.id
     and clinical_review_status = 'verified';

  -- Only the published, verified Core release is provisioned automatically.
  -- The expanded index remains a discovery/reference set until its clinical
  -- parameter definitions and local intervals are reviewed.
  for v_master in
    select *
      from public.master_catalog_tests
     where release_id = v_release.id
       and clinical_review_status = 'verified'
     order by master_code
  loop
    select test_id into v_existing
      from public.tenant_catalog_master_links
     where tenant_id = p_tenant_id
       and master_test_id = v_master.id;

    if v_existing is not null then
      continue;
    end if;

    -- Do not collide with a tenant-authored test that happens to use the same code.
    if exists (
      select 1 from public.tests_catalog
       where tenant_id = p_tenant_id
         and code = v_master.master_code
    ) then
      continue;
    end if;

    insert into public.tests_catalog(
      tenant_id,code,name,test_kind,category,specimen,method,turnaround_minutes,instructions,is_active,
      short_name,synonyms,loinc_code,clinical_category,clinical_purpose,service_type,
      patient_preparation,collection_requirements,specimen_requirements,transport_requirements,
      stability_requirements,rejection_criteria,biosafety_notes,critical_result_policy,
      reporting_notes,source_references,clinical_review_status,catalog_version,components
    ) values (
      p_tenant_id,v_master.master_code,v_master.canonical_name,v_master.test_kind,
      coalesce(v_master.category,v_master.definition->>'category'),
      v_master.definition->>'specimen',v_master.definition->>'method',
      nullif(v_master.definition->>'turnaround_minutes','')::integer,
      v_master.definition->>'instructions',true,
      v_master.definition->>'short_name',coalesce(v_master.alternate_names,'{}'),
      v_master.definition->>'loinc_code',v_master.definition->>'clinical_category',
      v_master.definition->>'clinical_purpose',coalesce(v_master.service_type,'laboratory_test'),
      coalesce(v_master.definition->'patient_preparation','{}'::jsonb),
      coalesce(v_master.definition->'collection_requirements','{}'::jsonb),
      coalesce(v_master.definition->'specimen_requirements','{}'::jsonb),
      coalesce(v_master.definition->'transport_requirements','{}'::jsonb),
      coalesce(v_master.definition->'stability_requirements','{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_master.definition->'rejection_criteria','[]'::jsonb))),'{}'),
      v_master.definition->>'biosafety_notes',
      coalesce(v_master.definition->'critical_result_policy','{}'::jsonb),
      v_master.definition->>'reporting_notes',
      coalesce(v_master.definition->'source_references','[]'::jsonb),
      v_master.clinical_review_status,v_release.version,
      coalesce(v_master.definition->'components','[]'::jsonb)
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
    where p.master_test_id=v_master.id
    order by p.display_order,p.parameter_code;

    update public.test_parameters tp
       set result_source=mp.result_source,
           formula=mp.formula,
           formula_expression=mp.formula_expression
      from public.master_catalog_parameters mp
     where tp.tenant_id=p_tenant_id
       and tp.test_id=v_test_id
       and mp.master_test_id=v_master.id
       and mp.parameter_code=tp.parameter_code
       and mp.result_source='calculated';

    select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order,p.parameter_code),'[]'::jsonb)
      into v_parameters
      from public.test_parameters p
     where p.tenant_id=p_tenant_id
       and p.test_id=v_test_id;

    insert into public.tenant_catalog_master_links(
      tenant_id,test_id,master_test_id,imported_release_id,last_applied_version,
      baseline_snapshot,customization_fields,sync_status
    ) values (
      p_tenant_id,v_test_id,v_master.id,v_release.id,v_release.version,
      jsonb_build_object(
        'test',(select to_jsonb(t) from public.tests_catalog t where t.id=v_test_id),
        'parameters',v_parameters
      ),
      '{}','current'
    );

    v_added := v_added + 1;
  end loop;

  return query select v_added,v_total,v_release.version;
end;
$function$;

revoke all on function public.ensure_tenant_core_catalog(uuid) from public, anon;
grant execute on function public.ensure_tenant_core_catalog(uuid) to authenticated;

comment on function public.ensure_tenant_core_catalog(uuid) is
  'Idempotently provisions missing clinically verified Core catalog definitions for a tenant on first authenticated workspace load. Existing tenant edits, prices and activation choices are preserved.';

commit;
