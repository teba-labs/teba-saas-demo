-- Copy Mayo pediatric CBC source intervals from their individually indexed analytes
-- into the corresponding parameters of the complete CBC profile. These remain
-- external suggestions and must not be used as local flags until method/analyzer
-- and population are verified by the tenant.
with pediatric_sources as (
  select
    target.id as target_parameter_id,
    source.parameter_code,
    jsonb_agg(interval.value order by (interval.value->'age'->>'min')::numeric) as pediatric_ranges
  from public.master_catalog_tests cbc
  join public.master_catalog_parameters target on target.master_test_id=cbc.id
  join public.master_catalog_tests individual
    on individual.master_code=target.parameter_code
   and individual.release_id=cbc.release_id
   and individual.test_kind='individual'
  join public.master_catalog_parameters source
    on source.master_test_id=individual.id
   and source.parameter_code=target.parameter_code
  cross join lateral jsonb_array_elements(coalesce(source.reference_ranges,'[]'::jsonb)) interval(value)
  where cbc.master_code='HEM_CBC'
    and cbc.release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
    and target.parameter_code in ('RBC','HGB','HCT','MCV','RDW_CV','WBC','PLT')
    and interval.value->>'population'='pediatric'
  group by target.id,source.parameter_code
)
update public.master_catalog_parameters target
set reference_ranges=(
      select coalesce(jsonb_agg(value),'[]'::jsonb)
      from (
        select value from jsonb_array_elements(coalesce(target.reference_ranges,'[]'::jsonb))
        union all
        select value from jsonb_array_elements(pediatric_sources.pediatric_ranges)
      ) ranges
    ),
    reference_interval_status='local_verification_required',
    source_references=(
      select coalesce(jsonb_agg(distinct ref),'[]'::jsonb)
      from (
        select jsonb_array_elements(coalesce(target.source_references,'[]'::jsonb)) ref
        union all
        select jsonb_build_object(
          'id','MAYO-CBC-9109-PEDS',
          'title','Complete Blood Cell Count (CBC) with Differential, Blood',
          'organization','Mayo Clinic Laboratories',
          'url','https://www.mayocliniclabs.com/test-catalog/Overview/9109',
          'scope','Pediatric age- and sex-specific external comparison intervals; not locally verified for the tenant analyzer/method/population.'
        ) ref
      ) refs
    ),
    clinical_metadata=coalesce(target.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
      'pediatric_reference_interval_note','Mayo-derived pediatric age/sex intervals copied from the matching individual analyte definition. External suggestions only; do not activate local result flags until verified against the tenant analyzer, method, reagent and population.'
    )
from pediatric_sources
where target.id=pediatric_sources.target_parameter_id;

