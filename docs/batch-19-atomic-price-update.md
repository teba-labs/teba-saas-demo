# Batch 19 — Atomic catalog price update

Date: 18 November 2026

## Implemented
- Added `database/migrations/008_atomic_catalog_price_update.sql` with `public.set_current_test_price(p_tenant_id, p_test_id, p_selling_price)`.
- The function checks active tenant-owner membership, validates null/negative/NaN/out-of-range numeric values, locks the tenant-scoped catalog test row, closes the previous current price and inserts the next price in one function transaction.
- The function intentionally uses invoker privileges (no `SECURITY DEFINER`), revokes execute from `PUBLIC` and `anon`, and grants execute to `authenticated`. Existing table grants, RLS owner policy, and the partial unique current-price index remain in force.
- Catalog repository now calls this single RPC and validates its returned row before changing the current-price cache.
- Fixed a cache defect discovered during review: the generic replacement helper could erase historical price rows when refreshing current prices. `replaceCachedCurrentPrices` now preserves historical rows, marks stale cached current rows historical, and upserts the returned current rows within the tenant/test scope.

## Cross-check against existing schema
- `test_prices` has a `numeric(12,2)` non-negative amount constraint and a partial unique index on `(tenant_id, test_id) WHERE is_current`.
- The existing owner-manage RLS policy and authenticated table grants permit the owner RPC's invoker-context writes while denying employees via RLS.
- `private.is_tenant_owner(uuid)` is executable by authenticated users and is a `SECURITY DEFINER` helper with a fixed `pg_catalog` search path, as already established by the base schema. The new RPC itself is not definer.
- The function's catalog-row lock serializes concurrent updates for one test; the partial unique index remains a final integrity guard.

## Validation performed
- `node --test tests/static/*.test.mjs`: 84 passed, 0 failed.
- `node --check` for 34 authored JavaScript files: all passed.
- Original-source manifest: 31/31 hashes match.
- Added static checks for the owner RLS/grant contract, unique-current-price index, input rejection, atomic ordering, and preservation of historical local cache rows.

## Not performed / release boundary
- No SQL was executed. Migration 008 has NOT been applied to TEST or production.
- No Supabase project was contacted; no live RPC, owner/staff, cross-tenant, or concurrency test was run.
- No browser runtime test or deployment occurred. Static tests do not prove PostgreSQL runtime behavior.

## Manual TEST plan after explicit approval
1. Confirm the intended isolated TEST project and inspect its migration ledger before applying 008.
2. As owner, replace an existing price; verify exactly one current row and the old row remains historical.
3. As owner, create the first price for a test.
4. As employee, call the RPC directly; expect permission denial and no price changes.
5. Run two concurrent owner updates for one test; verify one current row and no partial history update.
6. Try null, negative, NaN, Infinity/out-of-range values; verify rejection and unchanged current price.
7. Verify a second tenant's prices remain inaccessible and unchanged.

Do not apply this migration to production as part of this batch.
