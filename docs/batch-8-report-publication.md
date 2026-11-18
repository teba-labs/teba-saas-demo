# Batch 8 — audited report publication and correction foundation

## Added
- `database/migrations/003_atomic_report_publication.sql`
  - Adds the selected staff identity to each report version.
  - Adds `publish_report_version(...)`: validates authenticated branch access and active staff, locks the visit row, checks approval/completeness, allocates the next version, snapshots the visit/test/result values, inserts the immutable published report version, and marks the visit published in one database transaction.
  - A published visit can receive a later report version only with a documented correction reason.
  - Adds `correct_published_result(...)`: requires a published visit, branch access, active staff, and a reason; the existing audit trigger records before/after result values.
  - Uses transaction-local guards so direct browser inserts/updates cannot bypass the publication/correction RPCs.
  - Revokes direct authenticated insert/update/delete on `report_versions`; report versions are append-only.
  - Extends audit capture to include the selected report publisher staff identity.
- `supabase/functions/publish-report/index.ts`
  - Authenticated staff endpoint; JWT verification remains enabled.
  - Validates the user token, allowed origin, required IDs, PDF signature, MIME type and 10 MB maximum.
  - Uploads through the caller's RLS-scoped client, invokes the atomic database RPC, and removes an orphan upload server-side if the RPC fails.
  - Service-role key is used only inside the Edge Function for compensating cleanup and is never returned to the browser.
- `modules/reports/repository.js`
  - Browser API for report upload/publication, report version listing, signed staff download, and audited result correction.
- `tests/static/report-publication.test.mjs`
  - Static contracts for authorization, workflow, append-only versions, Edge Function security, and browser repository behavior.
- `supabase/config.toml`
  - Explicitly keeps JWT verification enabled for `publish-report`.

## Safety decisions
- Storage object path is `<tenant_uuid>/<visit_uuid>/<random>.pdf`, matching the existing Storage RLS policy's first two folder segments. The earlier schema comment describing an extra `reports/` prefix was inconsistent with that policy; this batch follows the actual policy implementation.
- Upload and database publication are not a single cross-service transaction. The database version insert and visit state change are atomic; if the database step fails, the Edge Function attempts server-side removal of the uploaded orphan. Cleanup failure is logged and must be monitored.
- A result correction changes the current result row only through the protected RPC; the existing audit log retains old/new row values. A new PDF report version must then be published with a reason.

## Not done / not verified
- Migration 003 has **not** been applied to the TEST Supabase project.
- `publish-report` Edge Function has **not** been deployed.
- `REPORT_ALLOWED_ORIGINS` and server-side Supabase secrets have **not** been configured.
- No authenticated live upload, report publication, correction, signed download, cross-tenant denial, or orphan cleanup test has been run.
- The current report PDF is supplied by the staff-side caller; PDF generation/rendering UI is not yet connected.
- The report repository is ready as a data-layer contract; no complete laboratory result approval/publication screens have been wired to it yet.

## Validation
- `node --test tests/static/*.test.mjs`: 21 tests passed, 0 failed.
- This is a static source-contract result only. It is not evidence of a live Supabase deployment or runtime authorization success.

## TEST deployment checklist (not yet executed)
1. Apply migrations 001, 002, then 003 to the TEST project only.
2. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `REPORT_ALLOWED_ORIGINS` as Edge Function secrets.
3. Deploy `publish-report` with JWT verification enabled.
4. Test employee from allowed branch, employee from another branch, other tenant, owner, missing staff, unapproved visit, incomplete test, first publication, correction with/without reason, direct table insert/update denial, signed download, and cleanup after forced RPC failure.
5. Do not point any deployment at the production project during this stage.
