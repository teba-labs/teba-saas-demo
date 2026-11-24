-- Allow signed-in lab users to read only the published global master catalog.
-- Tenant catalog rows remain protected by their existing tenant/branch RLS policies.
begin;

drop policy if exists master_catalog_releases_published_read on public.master_catalog_releases;
create policy master_catalog_releases_published_read
  on public.master_catalog_releases
  for select
  to authenticated
  using (status = 'published');

drop policy if exists master_catalog_tests_published_read on public.master_catalog_tests;
create policy master_catalog_tests_published_read
  on public.master_catalog_tests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.master_catalog_releases r
      where r.id = master_catalog_tests.release_id
        and r.status = 'published'
    )
  );

drop policy if exists master_catalog_parameters_published_read on public.master_catalog_parameters;
create policy master_catalog_parameters_published_read
  on public.master_catalog_parameters
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.master_catalog_tests t
      join public.master_catalog_releases r on r.id = t.release_id
      where t.id = master_catalog_parameters.master_test_id
        and r.status = 'published'
    )
  );

commit;
