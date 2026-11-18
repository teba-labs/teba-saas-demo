# Batch 6 — Website CMS and public-site data layer

Implemented in this batch:
- Tenant-scoped CMS settings read/update for public content, theme and publish state.
- An explicit allowlist of CMS collections: sections, public test catalog, packages, articles, FAQs, testimonials, offers and branch profiles.
- Tenant-scoped create/update/list helpers; authorization is delegated to database RLS and not inferred from local UI state.
- Visibility/publishing controls that do not hard-delete CMS records. Branch website visibility is kept separate from operational branch status.
- Public site resolver using `get_public_tenant_by_slug`, which only returns a published tenant in trial/active state.
- Public site loader limited to CMS tables; it never queries patient, result or report tables. Published-row filtering is delegated to the installed public RLS policies.

Static verification:
- CMS table allowlist and tenant scoping test.
- Public resolver and public-table-only test.
- Existing core, offline, repository, laboratory/results and batch-5 contract tests.

Not implemented or verified:
- No visual CMS editor or public website screens have been wired to these repositories.
- No live authenticated owner edit or anonymous public read has been exercised against Supabase.
- No content/image upload flow has been connected to `tenant-site-assets`.
- The patient portal remains disabled until a dedicated rate-limited Edge Function and safe lookup implementation are deployed and tested.
- Report publication/correction remains disabled until a single server-side transaction handles storage, report version, visit state and audit history.
