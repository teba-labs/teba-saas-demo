-- Mayo-derived adult CBC intervals are stored as source suggestions only.
-- They are not activated as local intervals until the tenant verifies its own method/analyzer.
with r as (
 select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1'
), ranges(code,range_json) as (
 values
 ('RBC','[{"population":"adult","sex":"male","age":{"min":18,"max":120,"unit":"years"},"lower":4.35,"upper":5.65,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"},{"population":"adult","sex":"female","age":{"min":18,"max":120,"unit":"years"},"lower":3.92,"upper":5.13,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('HGB','[{"population":"adult","sex":"male","age":{"min":18,"max":120,"unit":"years"},"lower":13.2,"upper":16.6,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"},{"population":"adult","sex":"female","age":{"min":18,"max":120,"unit":"years"},"lower":11.6,"upper":15.0,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('HCT','[{"population":"adult","sex":"male","age":{"min":18,"max":120,"unit":"years"},"lower":38.3,"upper":48.6,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"},{"population":"adult","sex":"female","age":{"min":18,"max":120,"unit":"years"},"lower":35.5,"upper":44.9,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('MCV','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":78.2,"upper":97.9,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('RDW_CV','[{"population":"adult","sex":"male","age":{"min":18,"max":120,"unit":"years"},"lower":11.8,"upper":14.5,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"},{"population":"adult","sex":"female","age":{"min":18,"max":120,"unit":"years"},"lower":12.2,"upper":16.1,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('WBC','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":3.4,"upper":9.6,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('PLT','[{"population":"adult","sex":"male","age":{"min":18,"max":120,"unit":"years"},"lower":135,"upper":317,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"},{"population":"adult","sex":"female","age":{"min":18,"max":120,"unit":"years"},"lower":157,"upper":371,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('NEUT_ABS','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":1.56,"upper":6.45,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('LYMPH_ABS','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":0.95,"upper":3.07,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('MONO_ABS','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":0.26,"upper":0.81,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('EOS_ABS','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":0.03,"upper":0.48,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb),
 ('BASO_ABS','[{"population":"adult","age":{"min":18,"max":120,"unit":"years"},"lower":0.01,"upper":0.08,"source":"Mayo Clinic Laboratories CBC","source_url":"https://www.mayocliniclabs.com/test-catalog/Overview/9109"}]'::jsonb)
)
update public.master_catalog_parameters p
set reference_ranges=ranges.range_json,
    reference_interval_status='local_verification_required',
    source_references=jsonb_build_array(jsonb_build_object(
      'id','MAYO-CBC-9109','title','Complete Blood Cell Count (CBC) with Differential, Blood',
      'organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/9109',
      'scope','Adult reference intervals by sex where applicable; external comparison only; verify locally against analyzer and population'
    )),
    clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
      'reference_interval_note','Mayo-derived adult comparison interval only. Not activated as a local reference interval until verified for the tenant analyzer, reagent, method, and population.'
    )
from ranges
join public.master_catalog_tests t on t.master_code='HEM_CBC'
join r on t.release_id=r.id
where p.master_test_id=t.id and p.parameter_code=ranges.code;

-- Qualitative parasitology expectation: negative unless organism is detected and identified.
update public.master_catalog_parameters p
set reference_ranges='{"text":"Negative / Not seen"}'::jsonb,
    source_references=jsonb_build_array(jsonb_build_object(
      'id','MAYO-OPE-619736','title','Ova and Parasite, Travel History or Immunocompromised, Feces',
      'organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/619736',
      'scope','Reference value negative; if positive, organism identified'
    ))
from public.master_catalog_tests t
where p.master_test_id=t.id and t.master_code='STOOL_EXAM'
 and t.release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
 and p.parameter_code in ('ST_OVA','ST_CYSTS','ST_TROPHOZOITES','ST_LARVAE');
