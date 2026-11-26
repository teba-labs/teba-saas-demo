# Offline engine contract — current implementation and completion gates

Last reviewed: 2026-11-25

## Existing implementation carried forward from main

- The current web application uses a dedicated Dexie/IndexedDB database named `TaibaSmartLabOfflineDB`; the legacy `TebaLabOfflineDB` is kept separate and is not migrated or deleted.
- Cached business data is tenant-scoped and, where applicable, branch-scoped. The cached tenant/branch membership context is keyed by the authenticated user ID; localStorage workspace preferences are not treated as authorization.
- The service worker precaches the application shell and offline modules, caches the Dexie/Supabase ESM entry modules after an online load, and never caches Supabase API responses or authenticated patient data.
- The durable Outbox uses secure UUID operation IDs, tenant/branch scope, dependency ordering, expiring leases, bounded exponential retry, conflict records, and explicit server acknowledgement before an operation is removed. During the current development phase, the explicit `offlineLicenseMode: 'development-bypass'` skips only the commercial signed-entitlement gate for new local writes; tenant/branch scope and server authorization remain required. The entitlement issuer and verifier remain in source for later reactivation.
- Server adapters cover patient creation, visit intake, payments, expenses, workday open/close, draft-result batches, culture isolates/susceptibilities, local approval reconciliation and local work-copy delivery audit events. Existing idempotent RPCs, stable operation IDs, result fingerprints and server-side audit writes are used.
- The reception/results path can create a local patient and visit, queue payments and draft results behind intake, map local visit/test IDs to server IDs, restore pending values after reload, calculate supported formula ASTs locally for provisional display, record a local approval intent that is server-validated against an unchanged clinical-result fingerprint, and print only an explicitly watermarked working copy while offline.
- Sync Center exposes queue counts, retry, conflict review, and a versioned local-device backup/restore. Backup restore is a tenant/branch-checked merge with SHA-256 integrity validation; it is not a full cloud backup and does not include remote Storage objects or records never cached on this device.

## Hardening in this development branch

- Re-enqueueing the same operation ID is idempotent only when tenant, branch, entity, action, payload, and dependencies match. Reuse with a different scope or payload is rejected.
- Dependency acknowledgements are checked against the same tenant and branch as the dependent operation.
- A worker/tab may mutate an operation's success, conflict, or failure state only while it still owns the active Outbox lease. This prevents an expired, slow request from overwriting a newer sync attempt.
- The service worker uses a bounded network-first request and falls back to cached content after timeout or network failure.
- A static integrity test verifies every local application-shell asset exists and all offline-critical modules are precached.
- Sync Center requests persistent browser storage only after an explicit user click and reports browser quota; it never deletes local data when storage is low or persistence is denied.
- Branch preparation validates the signed-in user's tenant/branch access, then warms the active catalog, current branch prices, active test-parameter snapshots, active staff, workday state, expense categories, lab identity, print settings, up to 10,000 patient rows, up to 500 worklist items, visit-specific range overrides, their result/culture data, the current cash snapshot and latest closing. It reports missing prices, missing staff and truncated data; an open workday is not required at preparation time because it can be opened locally.
- Service-worker network-first requests are time-bounded and fall back to cached assets when the connection stalls.
- Outbox re-enqueue, dependency scope, and lease ownership are hardened against duplicate calls and stale concurrent sync attempts.

## Still required before calling the offline engine production-ready

1. The signed entitlement implementation remains in source: ES256/P-256 issuance in `issue-offline-entitlement`, a non-exportable device key in IndexedDB, tenant/user/branch/device-bound claims, a 35-day maximum lease bounded by subscription end plus grace, and client signature verification. **Current development bypass is active in application code.** The live issuer endpoint returned HTTP 503 on 2026-11-26 because the configured signing key is not a valid P-256 pair. Do not rotate or replace secrets during the bypass phase. Before reactivation, inspect the existing secret securely, confirm its public/private pair and Key ID, and obtain owner approval before any key rotation.
2. Complete authenticated runtime acceptance on an isolated TEST environment: online preparation -> disconnect -> browser reload/restart -> local read/write paths -> local backup/restore -> reconnect -> exact-once server acknowledgement -> retry after lost response -> tenant/branch isolation.
3. Verify TEST database migrations and RPC contracts against the repository's current project-role mapping before applying any migration. The primary project must not be used for offline acceptance tests.

## Preparation limits

- The initial patient-directory warmup is capped at 10,000 rows and the active worklist warmup at 500 rows. The preparation screen reports truncation; a truncated branch is not marked ready. These caps can be revisited after measuring real customer data volumes.
- Browser persistent storage is best-effort and browser-controlled. It reduces automatic eviction risk where granted but does not replace local backup and a successful sync.

## Explicit phase boundary

The engine does not make every business action offline-capable by itself. A local approval intent may be recorded, but the existing server approval RPC remains authoritative and validates the same clinical results before setting the official approved state. Final report publication, patient portal access, attachments, WhatsApp, result corrections and direct test-status changes remain online-only. Offline print and handoff are explicitly recorded as working-copy actions, never as final publication.
