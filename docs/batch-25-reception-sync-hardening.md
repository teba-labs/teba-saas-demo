# Taiba Smart Lab — Batch 25: Reception & Sync Hardening

**Date:** 2026-11-18  
**Base:** Batch 24 development snapshot  
**Scope:** Local code review and static verification only.

## Changes made

1. Added `database/migrations/011_idempotent_cash_replay_hardening.sql`.
   - Payment and expense RPCs now check for an existing tenant-scoped idempotency key after authentication/branch access, before checking mutable staff, category, or workday state.
   - A replay is acknowledged only when the stored operation matches the original branch/visit/category, amount, payment method, staff, and notes/description as applicable.
   - Null idempotency keys are rejected.
   - Concurrent payment retries retain the workday and billing row locks and recheck the receipt before inserting.
   - Existing authenticated-only function grants are explicitly retained.
2. Updated `offline/supabase-adapters.js`.
   - Deterministic business-rule rejections are surfaced as conflicts rather than consuming exponential transient retries.
   - Patient replay compares the complete stored identity payload before acknowledging a pre-existing patient ID.
3. Updated `modules/reception/repository.js`.
   - A visit with a pending patient-creation dependency remains queued even if the browser has reconnected; the outbox dependency must be acknowledged first.
4. Added static tests:
   - `tests/static/cash-idempotency-replay.test.mjs`
   - `tests/static/reception-dependency-order.test.mjs`

## Findings addressed

- **Cash replay ordering:** A previously committed payment/expense could be rejected on retry if staff/category/workday state changed after the original commit but before the client received confirmation. The new migration makes a matching committed operation replayable before those mutable checks.
- **Patient → visit ordering:** A newly created offline patient could still be absent from the server when the user submitted a visit after connectivity returned. The visit now stays queued behind its patient operation.
- **Patient ID collision verification:** The sync adapter previously compared only a subset of the patient payload on duplicate IDs. It now compares the full identity fields available in the local create payload.
- **Permanent business rejections:** Known validation/workday/price conflicts are now directed to the conflict queue instead of being treated as transient network retries.

## Verification performed

- Static test suite: **103 passed, 0 failed**.
- JavaScript syntax checks: **71 files passed**.
- No SQL was executed against Supabase.
- No browser/device runtime test was performed in this batch.

## Not verified / required before release

- Migration 011 still requires SQL review and execution on the TEST Supabase project with a rollback/backup plan, followed by live PostgreSQL tests.
- Must test ambiguous commit/retry scenarios for payment and expense, including staff deactivation, category deactivation, workday closure, and mismatched idempotency payloads.
- Must test patient creation followed by visit submission across reconnect, with the outbox parent/child ordering in IndexedDB.
- Must test two tabs/devices submitting the same operation ID concurrently.
- Must confirm the Sync Center presents conflicts clearly and that a conflict is never silently discarded.
- No production deployment or production database change was made.

## Safety boundary

This batch changes only the local development copy. Migration 011 is a reviewed candidate file, not an applied migration. Supabase TEST and production remain untouched by this work.
5. Updated `assets/js/sync-center.js` so dependency-blocked operations are reported separately from transient failures in progress and completion messages.
