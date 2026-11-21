# Offline Results and Subscription Entitlement — Delivery Status

**Working branch:** `feature/offline-entitlement-completion-2026-11-21`  
**PR:** #35 (not merged; keep `main` protected)  
**TEST project:** `teba-lis-demo`

## Implemented

- Draft result batches are saved to IndexedDB when offline or when a request fails due to a transient network error.
- Each draft batch has a stable UUID. The server receipt is scoped to tenant, branch, user and exact payload; retries after a lost response return the original saved rows instead of inserting duplicates.
- Unsynced draft values are restored after navigation/reload and clearly marked as waiting for sync.
- Completion and approval remain online-only and are blocked while local result writes are pending.
- Reception can now create a local patient, a local visit and local visit-test snapshots while offline, then navigate directly to that visit in the results workbench.
- New local intake records are projected into the same cached worklist shape used by the results page. Patient, visit and result operations are dependency-ordered.
- After the intake RPC acknowledges the visit, the sync adapter stores a local-to-server visit/test ID map. Draft result operations wait for that mapping and then save against the server's real visit-test IDs.
- Catalog, current prices, all active test-parameter snapshots, staff, open workday, patient search results, tenant/branch access context, lab identity and print settings are cached for offline use after an online preparation pass.
- The results workbench restores queued values and evaluates supported catalog formula ASTs locally for display and provisional printing. Server-side calculation remains authoritative after synchronization.
- Cached visit data can be previewed and printed offline as a clearly marked **unapproved working copy**. The printout explicitly says it is not a final report and suppresses reviewer signature/stamp. Already approved/published visits retain their server-approved status.
- Culture isolate and susceptibility writes can be queued offline. They use tenant/branch/user/payload-bound idempotency receipts, dependency ordering (visit/test -> isolate -> susceptibility), and local-to-server ID mapping. Cached culture/AST rows remain readable during partial synchronization. Local backup format v3 includes these caches and remains backward-compatible with v1/v2 backup restore.
- The outbox contains no subscription-expiry gate. Already-created pending operations are retained and must be synchronized even if the subscription expires during an outage.
- Service-worker shell cache was advanced to v32 to refresh the offline app files.

## Database and CI evidence already established

- Migrations `074_offline_draft_results_idempotency` and `075_offline_culture_idempotency` were applied to TEST.
- The idempotent draft-result and culture/AST RPCs and private receipt table were verified on TEST; anon cannot execute these RPCs and authenticated can execute them.
- GitHub Actions run 1234 passed the JavaScript module check, browser-only build, static/unit tests, packaging and artifact upload (283/283 tests). An earlier run 1228 found a stale culture test contract; it was updated before run 1234.

## Still not complete — do not represent as production-ready

1. **Seven-day signed offline entitlement:** not implemented or enforced. No offline lock is active. A secure asymmetric signing key must be provisioned as a private Supabase Edge Function secret and the matching public key pinned in the client. The available project tools do not expose secret provisioning, so no key was fabricated or embedded in browser code.
2. **Official final report while offline:** the current offline print path is deliberately provisional. It does not create an approval, reviewer signature, publication record or patient-portal report. Official completion/approval/publication remains online-only until an auditable offline signing and conflict-resolution protocol is designed and tested.
3. **Offline corrections and status transitions:** range overrides, result corrections, test completion, visit approval and report publication remain online-only because they require immutable audit history, sign-off and conflict handling.
4. **Attachments and portal operations:** uploads, patient portal lookup and WhatsApp publication remain online-only.
5. **Seven-day entitlement and local signing:** the client currently has no enforced grace window; the signed license and offline approval key are not provisioned.
6. **Live authenticated end-to-end validation:** no live clinical account test has yet demonstrated the full sequence: disconnect after login -> create patient/visit -> enter all results -> reload -> provisional preview/print -> reconnect -> sync patient -> sync intake -> map server visit/test IDs -> sync results exactly once -> online completion/approval -> final report publication.
7. **Cross-device recovery:** IndexedDB is device-local. A local queue cannot appear on another device until synchronized. A local backup can preserve queued operations, but moving it to another device requires restore and subsequent authenticated synchronization.

## Required production behavior for entitlement

- The server issues a signed, tenant/user/branch-scoped offline token only after verifying membership and the current trial/subscription period.
- Token expiry is bounded by the earlier of subscription end and the configured offline grace period (default seven days).
- After token expiry, block only creation of new offline business operations. Keep local records readable/exportable and retain every queued operation.
- On reconnection, synchronize and obtain server acknowledgement for pending operations before applying restrictions to new operations.
- Subscription expiry must not prevent login for data export, access to historical records, recovery or pending sync.
- Never gate `syncOutbox` on subscription state.

## Next gated engineering work

- Provision a private Ed25519 signing secret and pinned public key, then implement/deploy the signed entitlement endpoint and narrow new-operation gate.
- Add idempotent server wrappers and dependency mapping for audited result corrections and range overrides.
- Design an explicit offline sign-off protocol before allowing final approval or official report issuance without a server.
- Run the full authenticated TEST scenario above, including lost-response retry, browser reload, expiry during outage, changed-price conflict and duplicate-sync checks.
