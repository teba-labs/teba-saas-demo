-- Publish the preserved legacy source-name index as an editable, explicitly unreviewed
-- catalog release. Do not promote clinical_review_status or fabricate missing fields.
begin;

insert into public.master_catalog_releases(version,title,description,status,published_at)
values (
  'taiba-expanded-index-2026.11.23-r2',
  'Taiba Expanded Medical Catalog — Editable Index',
  'Preserved legacy Egyptian-laboratory test names and categories. Entries remain needs_review; absent method, specimen, units, ranges, formulas and choices remain blank or generic editable placeholders. Tenant owners may import and complete locally.',
  'published',
  now()
)
on conflict (version) do update
  set title=excluded.title,
      description=excluded.description,
      status='published',
      published_at=coalesce(public.master_catalog_releases.published_at,excluded.published_at);

update public.master_catalog_tests t
   set release_id = r.id,
       updated_at = now()
  from public.master_catalog_releases r
 where r.version='taiba-expanded-index-2026.11.23-r2'
   and t.release_id in (
     select id from public.master_catalog_releases
      where version='taiba-legacy-name-index-2026.11.20-r1'
        and status='retired'
   )
   and t.clinical_review_status='needs_review';

commit;