-- 099: Retire the legacy name-only index so it can never leak into customer imports.
begin;
update public.master_catalog_releases
   set status='retired'
 where version='taiba-legacy-name-index-2026.11.20-r1'
   and status='published';
commit;
