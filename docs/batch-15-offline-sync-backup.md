# Batch 15 — Offline queue, synchronization and local backup

## Added
- A scoped Arabic Sync Center at `app/sync-center.html` with connection state, pending/syncing/failed/conflict counts, retry controls, and conflict review.
- A durable Dexie outbox with stable operation IDs, dependency ordering, lease recovery after interrupted sync, cross-tab Web Locks where supported, bounded exponential retry, and deletion only after an explicit server acknowledgement.
- Explicit Supabase adapters for patient creation, atomic visit intake, patient payments, and branch expenses. The adapters are tenant/branch scoped and use stable idempotency keys where the database contract supports them.
- Migration `007_offline_idempotent_visit_intake.sql`, which adds a server-side receipt and advisory transaction lock around offline visit intake. A repeated operation ID with identical payload returns the original visit ID; a changed payload is rejected.
- Offline visit intake carries expected price IDs and values. The server locks current price rows and rejects a changed/missing price snapshot into the conflict queue instead of silently repricing a visit.
- Local cache for patient search, staff, open workday, catalog, prices, parameters, expense categories, ledger and closing snapshots.
- Service worker app-shell and ESM CDN caching for previously loaded application dependencies. Supabase API responses are explicitly excluded from caching.
- Scoped JSON local-device backup with SHA-256 integrity check, tenant/branch validation, transactional merge restore, and preservation of pending queue dependencies.

## Offline operations currently supported
- New patient creation (queued with a stable patient UUID).
- Visit intake with selected tests, discount and initial payment (queued with expected price snapshot; dependent on a queued patient if needed).
- Patient payment through the existing idempotent payment RPC.
- Branch expense through the existing idempotent expense RPC.
- Catalog/staff/workday local reads after a successful online cache warm-up.

## Deliberately not queued yet
- Opening/closing a workday: these remain online-only because they control the authoritative branch cash period.
- Draft result entry, test completion, visit approval, PDF upload/publication and report correction: these need their own server-side idempotent and conflict-safe workflows before they can safely be queued.
- Full cloud backup/restore: the current backup is explicitly a local-device cache + pending-operations backup, not a complete tenant database or Storage backup. It must not be advertised as the final cloud backup requirement.

## Validation
- `node --test tests/static/*.test.mjs`: 63 tests passed, 0 failed.
- `node --check` passed for all modified JavaScript modules and the service worker.
- Service worker shell asset paths checked: no missing local files.
- ZIP integrity checked after packaging.

## Not verified
- Migration 007 has not been applied to TEST.
- No live Supabase login, multi-device network interruption, replay/duplicate retry, price-change conflict, or restore-on-second-device test has been run.
- No browser visual QA or mobile usability test has been run against the live TEST project.
- Dexie and Supabase ESM modules are cached only after the app is first loaded while online; first-time installation still requires connectivity.

## Required before production
1. Apply migrations 001–007 to the TEST project in order.
2. Configure only the TEST publishable key in `config/environment.js`.
3. Test patient + visit offline creation, then reconnect and verify exactly one patient, visit, invoice and payment.
4. Change a test price while a visit is queued and verify a conflict is shown, not silently repriced.
5. Test duplicate payments/expenses, branch isolation, and stale outbox recovery on two devices.
6. Build a separate full cloud backup/restore path covering all tenant operational tables, audit history and Storage objects, then perform a real restore drill.
