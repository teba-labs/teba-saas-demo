# Offline Results and Subscription Entitlement — Delivery Status

**Status reviewed:** 2026-11-25  
**Original implementation:** PR #35 — merged into `main` on 2026-11-21  
**Current hardening branch:** `feature/offline-core-completion-2026-11-25`  
**Current draft PR:** #68 — do not merge until phase-one gates pass  
**Current Supabase project roles:** `teba-lis-demo` (`hgqwpykeazuzceeiumjg`) is the primary project; `teba-lab` (`khjzoleiuiipyodpkieg`) is the designated TEST project.

## Implemented in the merged offline workflow

- Draft result batches are saved to IndexedDB when offline or when a request fails due to a transient network error.
- Each draft batch has a stable UUID. The server receipt is scoped to tenant, branch, user and exact payload; retries after a lost response return the original saved rows instead of inserting duplicates.
- Unsynced draft values are restored after navigation/reload and clearly marked as waiting for sync.
- Completion and approval remain online-only and are blocked while local result writes are pending.
- Reception can create a local patient, visit and visit-test snapshots while offline, then navigate directly to that visit in the results workbench.
- New local intake records are projected into the same cached worklist shape used by the results page. Patient, visit and result operations are dependency-ordered.
- After the intake RPC acknowledges the visit, the sync adapter stores a local-to-server visit/test ID map. Draft result operations wait for that mapping and then save against the server's real visit/test IDs.
- Catalog, current prices, active test-parameter snapshots, staff, open workday, patient search results, tenant/branch access context, lab identity and print settings are cached during online use.
- The results workbench restores queued values and evaluates supported catalog formula ASTs locally for display and provisional printing. Server-side calculation remains authoritative after synchronization.
- Cached visit data can be previewed and printed offline as a clearly marked **unapproved working copy**. The printout explicitly says it is not a final report and suppresses reviewer signature/stamp.
- Culture isolate and susceptibility writes can be queued offline. They use tenant/branch/user/payload-bound idempotency receipts, dependency ordering and local-to-server ID mapping. Local backup format v3 includes culture caches and remains backward-compatible with v1/v2 restore.
- The outbox has no subscription-expiry gate. Already-created pending operations are retained and must be synchronized even if a subscription expires during an outage.

## Phase-one hardening currently in PR #68

- Outbox enqueue is idempotent for an identical operation ID/scope/payload and rejects reuse with changed data.
- Dependency acknowledgements are tenant/branch scoped.
- A stale sync worker cannot overwrite a newer worker's result after losing its lease.
- Service-worker network-first requests have a bounded timeout and cached fallback.
- Sync Center reports browser persistent-storage support and quota; it never deletes local data automatically.
- An explicit branch-preparation action warms catalog, prices, parameter snapshots, staff, open workday, expense categories, lab/print settings, up to 10,000 patients, up to 500 worklist items and their cached results/culture data. It reports missing prices, staff, workday and any truncation instead of declaring a partial cache ready.

## Database and CI evidence

- PR #35 added migrations `074_offline_draft_results_idempotency` and `075_offline_culture_idempotency`; those migrations are present in the current primary project's migration history.
- The current designated TEST project `teba-lab` is **not ready for offline integration testing**: it has only 12 recorded migrations, and read-only schema checks found no `staff_directory`, `test_prices`, `private.can_access_branch`, or offline idempotency RPCs. Do not apply isolated offline migrations to this incomplete schema.
- The primary project has the full current migration history, including 074/075 and later migrations, but it must not be used for test mutations.
- GitHub CI for the current development branch has passed the static regression suite, browser-only build, JavaScript syntax checks, static contract tests and source packaging. Responsive contract and browser QA checks are being reconciled before acceptance.

## Still not complete — do not represent as production-ready

1. **Signed offline entitlement:** not implemented or enforced. No offline subscription lock is active. For the requested monthly internet cadence, the target lease is up to 35 days, bounded by the paid subscription period plus a small configured renewal grace. Use an asymmetric ES256/P-256 signature; keep the private key only in Supabase Edge Function secrets and pin only the public key in the client. No private key may be committed to source or exposed to the browser. The connected project tools do not expose secret provisioning.
2. **Authenticated runtime acceptance:** no live clinical account test has yet demonstrated disconnect after preparation -> browser reload/restart -> local read/write -> local backup/restore -> reconnect -> exact-once server acknowledgement -> retry after lost response -> tenant/branch isolation. The designated TEST database must first be brought to a compatible schema or replaced with an isolated development branch.
3. **Official final report while offline:** current offline print is deliberately provisional. It does not create an approval, reviewer signature, publication record or patient-portal report. Official completion/approval/publication remains online-only until an auditable offline sign-off and conflict-resolution protocol is designed and tested.
4. **Offline corrections and status transitions:** range overrides, result corrections, test completion, visit approval and report publication remain online-only because they require immutable audit history, sign-off and conflict handling.
5. **Attachments and portal operations:** uploads, patient portal lookup and WhatsApp publication remain online-only.
6. **Cross-device recovery:** IndexedDB is device-local. A local queue cannot appear on another device until synchronized. A local backup can preserve queued operations, but moving it to another device requires restore and subsequent authenticated synchronization.

## Required entitlement behavior

- The server issues a signed, tenant/user/branch-scoped offline token only after verifying active membership, branch access, tenant status and the current trial/subscription period.
- The offline lease may cover up to 35 days to support the customer's once-at-start/once-at-end monthly connection pattern, but cannot extend beyond the paid period plus the configured renewal grace.
- After token expiry, block only creation of new offline business operations. Keep local records readable/exportable and retain every queued operation.
- On reconnection, synchronize and obtain server acknowledgement for pending operations before applying restrictions to new operations.
- Subscription expiry must not prevent login for data export, access to historical records, recovery or pending sync.
- Never gate `syncOutbox` on subscription state.

## Next gated work after phase one

- Provision the private signing key in TEST Edge Function secrets and implement/deploy the signed entitlement endpoint with the public verification key in the client.
- Bring the designated TEST environment to a compatible migration baseline without touching primary data, then run the authenticated offline acceptance scenario.
- Phase two will handle the remaining audited business operations and their offline policy; final approval/publication stays online-only unless a separate safe signing design is approved.
