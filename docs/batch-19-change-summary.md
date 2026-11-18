# Batch 19 change summary

- Atomic owner-only catalog price update via migration 008 (prepared only; not applied).
- Repository price writes use the atomic RPC.
- Current-price cache refresh now preserves historical prices and tenant/test scope.
- Added static regression tests for migration/RLS/grants/validation/cache behavior.
- Validation: 84/84 static tests, 34/34 JavaScript syntax checks, 31/31 original-source hashes.
- No live Supabase test, SQL execution, or deployment.
