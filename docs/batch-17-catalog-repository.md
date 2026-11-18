# Batch 17 — Catalog repository foundation

Date: 18 November 2026

## Scope
This is a focused repository/cache improvement, not the completed Catalog user interface.

- Added tenant-scoped cache replacement for complete catalog refreshes and per-test parameter/current-price refreshes.
- Added catalog test save validation and activation/deactivation methods.
- Added test-parameter save validation and activation/deactivation methods.
- Kept price writes separate and protected by the existing owner-only `test_prices` RLS policy.
- Uses deactivation rather than hard deletion for tests/parameters so historical visit references and snapshots are preserved.
- Added static contract tests for the new repository methods, cache scope, and owner-only price policy.

## Validation
- `node --test tests/static/*.test.mjs`: 71/71 passed.
- JavaScript syntax checks: all 33 JavaScript files outside `source_original/` passed.
- No SQL was executed, no migration was added or run, no Supabase project was contacted, and no deployment occurred.

## Known next work
- Build the Arabic Catalog management screen (test list/editor, parameter editor, owner-only price editor) and wire it to the repository.
- Confirm whether employees should be allowed to hard-delete catalog entries. Current schema permits hard deletion only for owners; this batch deliberately uses safe deactivation and does not broaden database permissions.
- Review `setCurrentPrice`: current implementation closes the previous row and inserts a new row in two client requests. A future atomic server RPC/migration is recommended before production use; do not run such migration without explicit approval.
- Add browser/runtime tests for owner vs employee flows and online/offline cache refresh.
