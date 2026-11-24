-- The legacy fourth column classified a test as "core" for the old site's filter.
-- It did not mean hidden from the public catalog: the old "all tests" view included every row.
-- Map that classification to the public site's catalog visibility correctly.
begin;
update public.site_test_catalog s
   set is_visible=true
  from public.tenants t
 where s.tenant_id=t.id
   and t.slug='teba-labs'
   and s.code like 'TEBA-%';
commit;
