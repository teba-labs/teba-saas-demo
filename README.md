# Taiba Smart Lab — Neutral Development Workspace

This is a separate development copy. `source_original/teba-lab-main/` is immutable reference material; do not edit it. The production Supabase project is not used.

## Current target
- Supabase TEST URL: `https://hgqwpykeazuzceeiumjg.supabase.co`
- Project ref: `hgqwpykeazuzceeiumjg`
- Frontend key: TEST project publishable browser key is configured in `config/environment.js` (never use a service_role key in browser code).
- Never put a `service_role` key or any secret in browser code.

## Implemented
- Full source inventory and static audit are in `docs/`.
- Core environment configuration, Supabase client factory, Auth helpers, tenant/branch context resolver and schema contract are in place.
- The new core validates the TEST project URL and publishable browser key before startup.
- The legacy source remains unchanged.

## Not yet verified
- Browser login against the TEST project.
- Actual RLS behavior across two tenants and multiple branches.
- Offline synchronization and data restoration.
- End-to-end workflows. No old screen has been pointed at the new schema yet because its data model differs materially.

## Run the static config test
From this folder, with Node.js installed:

```bash
node --experimental-default-type=module tests/static/core-config.test.mjs
```

This workspace is not a production release. Do not deploy until the remaining migration and security tests pass.

## Latest development batch
Batch 5 adds report-version history/signed-download foundations, tenant settings, branch staff directory, and branch dashboard data repositories. See `docs/batch-5-report.md`. Publication and patient portal remain intentionally disabled until server-side atomic publication and a rate-limited Edge Function are implemented and tested.

## Latest development batch
Batch 6 adds the tenant-scoped website CMS repository and public-site content loader. These are data-layer foundations only; no CMS editor or website UI is wired yet. See `docs/batch-6-report.md`.

## Latest development batch — patient portal foundation
- Added a patient-facing portal page and a server-side Edge Function source for exact tenant-slug + patient-name + visit-number lookup.
- The Edge Function returns only the newest published PDF through a 120-second signed URL; failed lookups use a generic message.
- Added HMAC-hashed lookup/IP attempt logging and an initial rolling-window limiter, plus a migration to keep attempt logs inaccessible to browser roles.
- Deployment and live security testing are still pending. Configure Edge Function secrets and allowed origins before deployment. The current limiter is not atomic under concurrent requests; strengthen it before public launch.
- Report publication/correction remains disabled until its own atomic server-side workflow is implemented and tested.

## Latest development batch
- Batch 7: patient portal lookup foundation (not deployed or live-tested).
- Batch 8: audited report publication/correction foundation (not deployed or live-tested).
- Apply migrations in order: `001_initial_schema_v1.sql`, `002_patient_portal_hardening.sql`, `003_atomic_report_publication.sql` — TEST project only.
- Before deploying `publish-report`, configure server-side Edge Function secrets and `REPORT_ALLOWED_ORIGINS`. Keep JWT verification enabled. Never put `SUPABASE_SERVICE_ROLE_KEY` in browser code.
- The current automated suite is static-only; it does not establish live RLS, Edge Function, Storage, or multi-tenant isolation.

## Latest development batch — results workbench
- Batch 9 adds a separate Arabic results workbench page at `app/results-workbench.html`.
- It wires the new-schema repositories into a basic staff workflow: branch work list, parameter result entry, test completion, visit approval, PDF publication, and audited one-result-at-a-time corrections.
- It does not replace or edit the legacy screens in `source_original/`.
- Validation: 24 static tests pass and JavaScript syntax checks pass. Browser/Supabase runtime testing remains pending; the TEST publishable key remains intentionally blank.

## Latest development batch — reception intake
- Batch 10 adds a separate Arabic reception page at `app/reception.html` for branch-scoped patient search/registration, visit intake, catalog test selection and billing preview.
- Migration `004_atomic_visit_intake.sql` creates the visit, test snapshots, invoice and optional first payment in one database transaction. Apply it to TEST only, after migrations 001–003.
- Patient creation remains a separate pre-visit action; the visit/billing/payment transaction is atomic.
- Static tests passed; browser/Supabase runtime and SQL execution remain unverified. See `docs/batch-10-reception-intake.md`.

## Latest development batch — workday and cash control
- Batch 11 adds a separate Arabic workday page at `app/workday.html` for opening/closing the branch workday, recording shift expenses, and reviewing the cash ledger summary.
- Migration `005_workday_cash_control.sql` links new payments and expenses to the manually open workday, including payments created during atomic reception intake. Apply after migrations 001–004 on TEST only.
- Validation: 36 static tests pass. PostgreSQL execution, live login, RLS and concurrency checks remain pending. See `docs/batch-11-workday-cash-control.md`.

## Batch 12 — Owner dashboard
- New owner-only monthly dashboard: `app/dashboard.html`.
- Monthly collections/expenses are read from `financial_ledger`; invoice values, discounts, receivables, branch comparisons and test movement are reported separately.
- Net cash is not presented as profit. Per-test profitability remains unavailable until reliable test-cost data and overhead allocation are modeled.
- See `docs/batch-12-owner-dashboard.md` for limitations and validation status.

## Batch 14 — Platform administration console
- Added `app/platform-admin.html` for platform-owner login, aggregate tenant overview, plan metadata management, and tenant/subscription status management.
- Added migration `006_platform_admin_console.sql`; apply after migrations 001–005 on TEST only.
- Tenant onboarding requires an already-registered owner Auth email. The database provisions tenant, owner membership, lab/site settings, usage metadata, and an initial trial subscription atomically. No Auth passwords or service-role keys are used in the browser.
- Platform list RPC returns aggregate metadata only; it does not return patient identities, individual visits, test results, PDFs, invoices, or financial-ledger rows.
- Validation is static only. PostgreSQL execution, real platform-admin login, email resolution, and RLS must still be tested live. No tenant was created and Taiba was not registered.

## Batch 15 — Offline sync and local backup foundation
- Added `app/sync-center.html` with scoped queue status, retry, conflict review, and local backup export/restore.
- Added durable outbox leases, dependency ordering, stale lease recovery, cross-tab lock support, and explicit server acknowledgement before queue deletion.
- Added queue adapters for patient creation, atomic visit intake, patient payments and branch expenses.
- Added migration `007_offline_idempotent_visit_intake.sql` for server-side idempotent visit intake. It verifies expected current price IDs/values and sends price changes to conflict review rather than silently repricing.
- Added a service worker app shell and runtime ESM cache. Authenticated Supabase API responses are never cached.
- Local backup covers only data cached on this device plus pending operations. It is NOT a complete cloud backup of a tenant or Storage.
- Opening/closing workdays and result entry/completion/approval/publication/correction remain online-only until their own safe server idempotency workflows are implemented.
- Apply migration 007 only on TEST, after 001–006. Live browser/RLS/replay/restore tests are still pending. See `docs/batch-15-offline-sync-backup.md`.

## Batch 16 — unified application launcher and integration
- Added `app/index.html` as the unified Arabic RTL application entry point.
- Navigation visibility follows tenant membership role: staff see reception, results, workday and sync; tenant owners additionally see the financial dashboard and CMS.
- Added return-to-home navigation across app pages.
- Service worker cache v2 now includes all app pages, styles, scripts and local module dependencies; offline navigation falls back to the launcher. Authenticated Supabase API responses are still never cached.
- Validation: 67 static tests pass; JavaScript syntax and local path checks pass; source-original manifest checks match 31/31 files.
- Visual browser QA and live Supabase tests remain pending. This completes the planned development batches but does not make the workspace production-ready. See `docs/batch-16-final-integration.md`.


## Catalog management (Batch 18)
Arabic catalog administration is available at `app/catalog.html`. Owners and staff can manage test and technical parameter records; current price editing is owner-only and additionally protected by Supabase RLS. Catalog writes currently require an online connection. See `docs/batch-18-catalog-ui.md` for validation and known limitations.


## Batch 19 — TEST cloud hardening (2026-11-18)
- Migrations 012–016 are applied to the separate TEST Supabase project. The existing 46 public tables were preserved; no table rebuild or destructive data migration was performed.
- Added cross-branch payment attribution, branch-specific test prices with immutable visit snapshots, and atomic patient-portal rate limiting.
- Catalog/reception and offline price caching now resolve the effective price for the selected branch. Service-worker shell cache is v5.
- Deployed `patient-portal-lookup` (anonymous endpoint with internal rate limiting) and `publish-report` (JWT-protected) to TEST. Both fail closed until the required origin allowlists and portal hash secret are configured.
- Storage policies remain private for reports, attachments and backups; only tenant site assets are public-read.
- The draft development PR is not merged. Full browser tests, PDF upload, cross-branch payment tests, two-tenant RLS tests and offline multi-device replay remain pending. See `docs/batch-19-cloud-hardening.md`.
