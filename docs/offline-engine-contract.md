# Offline engine contract — current implementation and completion gates

Last reviewed: 2026-11-25

## Existing implementation carried forward from main

- The current web application uses a dedicated Dexie/IndexedDB database named `TaibaSmartLabOfflineDB`; the legacy `TebaLabOfflineDB` is kept separate and is not migrated or deleted.
- Cached business data is tenant-scoped and, where applicable, branch-scoped. The cached tenant/branch membership context is keyed by the authenticated user ID; localStorage workspace preferences are not treated as authorization.
- The service worker precaches the application shell and offline modules, caches the Dexie/Supabase ESM entry modules after an online load, and never caches Supabase API responses or authenticated patient data.
- The durable Outbox uses secure UUID operation IDs, tenant/branch scope, dependency ordering, expiring leases, bounded exponential retry, conflict records, and explicit server acknowledgement before an operation is removed.
- Server adapters currently cover patient creation, visit intake, payment, expense, draft-result batches, culture isolates, and culture susceptibility rows. Their server writes use existing idempotent RPCs or stable row identities.
- The reception/results path can create a local patient and visit, queue draft results behind intake, map local visit/test IDs to server IDs, restore pending draft values after navigation/reload, calculate supported formula ASTs locally for provisional display, and print an explicitly unapproved working copy.
- Sync Center exposes queue counts, retry, conflict review, and a versioned local-device backup/restore. Backup restore is a tenant/branch-checked merge with SHA-256 integrity validation; it is not a full cloud backup and does not include remote Storage objects or records never cached on this device.

## Hardening in this development branch

- Re-enqueueing the same operation ID is idempotent only when tenant, branch, entity, action, payload, and dependencies match. Reuse with a different scope or payload is rejected.
- Dependency acknowledgements are checked against the same tenant and branch as the dependent operation.
- A worker/tab may mutate an operation's success, conflict, or failure state only while it still owns the active Outbox lease. This prevents an expired, slow request from overwriting a newer sync attempt.
- The service worker uses a bounded network-first request and falls back to cached content after timeout or network failure.
- A static integrity test verifies every local application-shell asset exists and all offline-critical modules are precached.

## Still required before calling the offline engine production-ready

1. Implement and enforce a server-issued, signed, tenant/user/branch-scoped offline entitlement. The private signing key must remain in Supabase Edge Function secrets and the public verification key may be pinned in the client. No private key may be committed to this repository or exposed to the browser.
2. Add a controlled online preparation/health check that confirms the required app shell, membership context, branch workday, staff, catalog, current prices, parameter snapshots, lab identity, and print settings are present locally before the user relies on offline operation.
3. Request and report persistent browser storage where supported, and report quota/storage health without deleting queued operations.
4. Complete authenticated runtime acceptance on an isolated TEST environment: online preparation -> disconnect -> browser reload/restart -> local read/write paths -> local backup/restore -> reconnect -> exact-once server acknowledgement -> retry after lost response -> tenant/branch isolation.
5. Verify TEST database migrations and RPC contracts against the repository's current project-role mapping before applying any migration. The primary project must not be used for offline acceptance tests.

## Explicit phase boundary

The engine does not make every business action offline-capable by itself. Official test completion, visit approval, audited corrections, final report publication, patient portal access, attachments, and WhatsApp remain online-only until their own audited domain workflows are separately implemented and accepted. Offline print remains a clearly marked working copy, never a final approved report.
