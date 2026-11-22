-- Give every legacy individual master test one editable, non-clinical result placeholder.
-- No unit, reference interval, critical limit or numeric interpretation is invented.
-- The tenant owner must set the actual value type, unit, method and local interval.
insert into public.master_catalog_parameters(
  master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
  reference_ranges,critical_ranges,choices,display_order,is_required,result_source,
  clinical_review_status,reference_interval_status,clinical_metadata,source_references
)
select
  t.id,'RESULT',t.canonical_name||' — result',null,'text',2,
  '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,0,true,'manual',
  'needs_review','local_verification_required',
  jsonb_build_object(
    'template_placeholder',true,
    'review_note','Generic editable result placeholder only. The tenant owner must confirm whether the assay is numeric, text or qualitative, then set its reporting unit, method and locally verified reference interval before clinical use.',
    'reference_interval_note','No reference interval or critical threshold has been supplied.'
  ),
  '[]'::jsonb
from public.master_catalog_tests t
where t.test_kind='individual'
  and not exists (
    select 1 from public.master_catalog_parameters p where p.master_test_id=t.id
  );
