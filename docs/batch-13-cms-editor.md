# Batch 13 — Tenant Website CMS Editor

## Delivered
- Added `app/cms-editor.html`, a separate Arabic RTL owner-only CMS screen.
- Added `assets/js/cms-editor.js` and `assets/css/cms-editor.css`.
- Reuses the existing `website/cms-repository.js`; no new table or migration was introduced.
- Supports listing, creating, editing, and visibility/publication toggling for sections, website test catalog, packages, articles, FAQs, testimonials, offers, and branch profiles.
- Supports editing `public_content` and `theme_json`, and publishing/unpublishing the public site.
- Keeps public website test prices separate from operational test prices and invoices.
- No hard delete controls; visibility and publication are preferred so content can be restored.
- Requires owner membership in the tenant context. Database RLS remains the actual authorization boundary.

## Validation
- Static contract tests added in `tests/static/cms-editor.test.mjs`.
- These tests do not establish browser runtime correctness, Supabase RLS correctness, storage upload correctness, or live publishing.

## Known limitations / not verified
- TEST Supabase publishable key remains intentionally blank in `config/environment.js`; live login and data access cannot be tested yet.
- No live browser test or multi-tenant RLS test was performed.
- Image paths are editable as text; image upload/storage picker is not implemented.
- Branch profiles use a branch selector populated from the authenticated tenant context.
- Public template rendering/customization is still handled by the separate public-site layer; this batch edits content but does not introduce a visual drag-and-drop builder.
- Existing source-original files and production Supabase project were not modified.
