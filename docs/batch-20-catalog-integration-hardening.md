# Batch 20 — Catalog integration hardening

Date: 18 November 2026

## Findings and changes
- Fixed duplicate tenant-switch handling in `assets/js/catalog.js`: startup previously assigned both an `onchange` property and an `addEventListener('change', ...)` listener, causing duplicate tenant reloads.
- Added tenant-load request sequencing so a slower response from a previously selected tenant cannot overwrite the currently selected tenant's catalog or prices.
- Added selected-test request sequencing so a slower parameter response from a previously selected test cannot replace the parameters displayed for the newly selected test.
- Removed an empty `testActive` change listener that performed no action.
- Wrapped local current-price cache demotion/upsert in one Dexie read-write transaction. If either write fails, IndexedDB rolls back the transaction instead of leaving a half-updated current-price cache.
- Added static regression tests for duplicate event listeners, stale async responses, and transactional local price-cache updates.

## Validation
- `node --test tests/static/*.test.mjs`: 86 passed, 0 failed.
- `node --check` for 34 authored JavaScript files: all passed.
- Original-source manifest: 31/31 SHA-256 hashes match.
- A headless Chromium page-load attempt did not complete within the execution window; browser runtime verification is therefore still NOT confirmed.

## Boundaries
- Migration 008 remains a source artifact only; it has NOT been executed on TEST or production.
- No Supabase project was contacted. No live owner/staff, RLS, cross-tenant, RPC, or concurrency test was performed.
- No deployment occurred.

## Next review
- Continue catalog-to-reception/results integration review, especially immutable visit test snapshots and whether historical visit outputs remain stable after catalog/parameter edits.
- Then perform controlled browser and TEST-project checks only after explicit approval and confirmation of the target TEST project.
