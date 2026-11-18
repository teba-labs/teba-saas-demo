# Batch 24 — Offline cache reconciliation for branch staff

## Why this change was needed
The reception and workday screens fetched only active staff for the selected branch, but cached the response with `cacheRows`, which only upserts returned rows. If a staff member was deactivated or removed from the branch while the device was online, the older cached row could remain marked active. A later offline session could therefore continue displaying that stale staff member and queue an operation that the server would eventually reject.

## Change
- Extended `replaceCachedRows` with an optional `branchId` scope.
- Replacement deletes/replaces only rows belonging to the selected tenant and selected branch; rows for other branches and tenants remain untouched.
- Reception and workday screens now reconcile the selected branch's active staff cache against the latest server response, including an empty response.
- No SQL, Supabase migration, RLS policy, production configuration, or deployment was changed.

## Verification
- Static suite: 97 passed, 0 failed.
- JavaScript syntax checks: 34/34 passed.
- ZIP integrity: to be verified after packaging.

## Boundaries
- These are source-level/static checks. No browser session, IndexedDB runtime, multi-tab race, live Supabase request, or device-offline acceptance test was run in this batch.
- A deactivation that happens while a device is already offline cannot be known until the device reconnects. Server-side authorization remains authoritative and must reject stale staff identities.
- The change does not make workday opening/closing or result entry offline-capable.
