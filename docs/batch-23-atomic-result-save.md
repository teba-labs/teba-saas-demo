# Batch 23 — Atomic draft result saving

## Change
The results workbench previously awaited one `saveDraftResult` request per populated parameter. If a later request failed, earlier parameters could already have been committed, leaving a partially saved test.

The workbench now gathers all populated fields and sends one `saveDraftResults` request. The repository performs client-side type/choice/duplicate-code checks and calls the single RPC `save_draft_results_atomic`.

Migration 010 creates that RPC. It:
- requires an authenticated user and branch membership;
- validates the active staff identity belongs to the selected tenant and branch;
- locks the visit and visit-test rows while checking that the visit is not published;
- rejects empty batches, oversized batches, blank or duplicate parameter codes;
- inserts/updates all submitted rows in one transaction;
- relies on the existing result-validation and published-result triggers for frozen-snapshot value validation and correction protections;
- grants execution only to `authenticated` (not `anon`/`public`).

## Safety boundaries
- Migration 010 has not been executed against Supabase.
- No live database, RLS, rollback, concurrency, browser, storage, Edge Function, or deployment test was performed.
- The SQL migration must be reviewed and tested on TEST before any production consideration.
- The existing audited correction path for published results is unchanged.

## Next validation
After approval to use TEST, apply the reviewed migration there and test: valid multi-parameter save; invalid final parameter causes zero rows to change; duplicate parameter code rejection; staff from another branch rejection; cross-tenant/branch rejection; published visit rejection; concurrent saves to the same visit-test; and confirmation that existing values remain unchanged after a failed batch.

## Local verification result
- Static suite: **96 passed, 0 failed**.
- JavaScript syntax: **34/34 passed**.
- ZIP archive integrity: **passed** (`unzip -t`).
- PostgreSQL parsing/execution was not available in this workspace; SQL behavior is therefore source-reviewed but not runtime-verified.
