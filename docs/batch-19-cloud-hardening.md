# Batch 19 — TEST cloud hardening and branch-aware workflows

Date: 2026-11-18

## Scope and safety
- Targeted only the separate TEST project `hgqwpykeazuzceeiumjg` and the `teba-saas-demo` development repository.
- Preserved the existing 46 public tables. No tables were dropped or rebuilt, and no patient/visit/payment rows were deleted.
- Migrations 012–016 were applied to TEST. They are also committed on the development branch.
- The changes are in draft PR #1 and have not been merged into `main`.

## Database changes
- `012_restrict_trigger_function_execute.sql`: removes direct browser-role execution from the report-version immutability trigger function.
- `013_cross_branch_debt_collection.sql`: adds `payments.origin_branch_id`; `payments.branch_id` remains the branch that actually received the money. The payment ledger therefore remains attributed to the collecting branch.
- `014_branch_specific_test_prices.sql`: adds nullable `test_prices.branch_id`; a branch override takes precedence over the tenant-wide base price. Visit-test price snapshots remain immutable. Offline intake validates the effective price ID and amount before replay.
- `015_cross_branch_payment_retry_hardening.sql`: ensures committed payment retries remain idempotent even if the staff/workday state changes after the original transaction.
- `016_atomic_patient_portal_rate_limit.sql`: adds a service-role-only RPC that serializes lookup/IP rate-limit checks and writes the attempt record atomically.

## Application integration
- Catalog management supports a tenant-wide base price and optional per-branch overrides.
- Reception resolves the effective price for the active branch.
- IndexedDB schema version 3 adds a branch-price index. Service-worker shell cache is version 5.
- Offline payment queue records the employee's collection branch, not the visit's origin branch.
- The database/repository supports cross-branch collection; a dedicated user-facing debt-collection workflow still needs end-to-end UI wiring.

## Storage and Edge Functions
- Existing private buckets and Storage policies were retained: reports, attachments, and backups remain private; site assets remain public-read with owner-managed writes.
- `publish-report` deployed to TEST and is ACTIVE with JWT verification enabled.
- `patient-portal-lookup` deployed to TEST and is ACTIVE with JWT verification disabled intentionally; it performs exact tenant/name/visit matching and returns a 120-second signed URL.
- Portal rate limiting is atomic and service-role-only. A database check confirmed five matching attempts are allowed and the sixth is blocked; temporary test records were deleted.
- A rollback-safe database check confirmed a branch-specific price overrides the base price and a branch without an override uses the base price.

## Required runtime configuration
Set these Edge Function secrets in the TEST project's dashboard before browser testing:
- `PORTAL_ALLOWED_ORIGINS`: comma-separated exact website origins.
- `REPORT_ALLOWED_ORIGINS`: comma-separated exact website origins.
- `PORTAL_HASH_SECRET`: a fresh random secret with at least 32 bytes of entropy.

Do not send these values in chat and never place them in browser code. The functions fail closed if their custom configuration is absent.

## Verification status
- Confirmed the 46 public tables remain.
- Confirmed the portal rate-limit RPC is executable only by `service_role`.
- Confirmed the trigger-only report function is no longer directly executable by browser roles.
- Checked JavaScript syntax for changed application modules and service worker.
- Static test files were updated, but there is no GitHub Actions workflow run attached to this branch. The full Node static suite has not been executed in this environment.
- Not yet tested end-to-end: authenticated login, real PDF upload/publication, patient portal browser request with configured origins/secrets, cross-branch collection with two live staff accounts, two-tenant RLS isolation, and offline replay on multiple devices.

This batch is a TEST development step, not a production release.

## Migration registry note
The live project currently exposes only the custom `public.schema_migrations` table with the initial `1.0.0` record; the standard `supabase_migrations.schema_migrations` table is absent. Migrations 012–016 were applied directly and verified, but no partial history records were inserted because migrations 002–011 must first be reconciled as a complete sequence. Do not run an automated migration replay until that reconciliation is completed.
