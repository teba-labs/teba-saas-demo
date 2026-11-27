-- 129: Make missing master review statuses explicit without promoting any definition.
-- This is metadata normalization only; no test, parameter, range, formula or tenant data changes.
begin;

update public.master_catalog_tests
   set clinical_review_status='needs_review',
       updated_at=now()
 where clinical_review_status is null;

update public.master_catalog_parameters
   set clinical_review_status='needs_review'
 where clinical_review_status is null;

commit;
