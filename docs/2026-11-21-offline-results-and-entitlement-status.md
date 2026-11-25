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
- Draft result writes are cached locally. A user may record a clearly marked local approval intent while offline; it is not an official server approval. After all queued visit/result operations sync, the server rechecks the original user, branch scope and a SHA-256 fingerprint of the clinical result content before running the existing atomic approval RPC. Final publication remains online-only.
- Reception can create a local patient, visit and visit-test snapshots while offline, then navigate directly to that visit in the results workbench.
- New local intake records are projected into the same cached worklist shape used by the results page. Patient, visit and result operations are dependency-ordered.
- After the intake RPC acknowledges the visit, the sync adapter stores a local-to-server visit/test ID map. Draft result operations wait for that mapping and then save against the server's real visit/test IDs.
- Catalog, current prices, active test-parameter snapshots, staff, open workday, patient search results, tenant/branch access context, lab identity and print settings are cached during online use.
- The results workbench restores queued values and evaluates supported catalog formula ASTs locally for display and provisional printing. Server-side calculation remains authoritative after synchronization.
- Cached visit data can be previewed and printed offline as a clearly marked **unapproved working copy**. The printout explicitly says it is not a final report and suppresses reviewer signature/stamp.
- Culture isolate and susceptibility writes can be queued offline. They use tenant/branch/user/payload-bound idempotency receipts, dependency ordering and local-to-server ID mapping. Local backup format v3 includes culture caches and remains backward-compatible with v1/v2 restore.
- New offline business operations require a valid server-signed ES256 entitlement bound to tenant, branch, user and a non-exportable browser-device key. Entitlement expiry blocks new queued writes only; already-created operations remain retained and `syncOutbox` is never gated, so pending work can still synchronize.

## Phase-one hardening currently in PR #68

- Outbox enqueue is idempotent for an identical operation ID/scope/payload and rejects reuse with changed data.
- Dependency acknowledgements are tenant/branch scoped.
- A stale sync worker cannot overwrite a newer worker's result after losing its lease.
- Service-worker network-first requests have a bounded timeout and cached fallback.
- Sync Center reports browser persistent-storage support and quota; it never deletes local data automatically.
- An explicit branch-preparation action warms catalog, prices, parameter snapshots, staff, workday state, expense categories, lab/print settings, up to 10,000 patients, up to 500 worklist items, visit-specific range overrides and their cached results/culture data. It reports missing prices, staff, truncation and entitlement readiness instead of declaring a partial cache ready; an open workday is not required at preparation time because the next day can be opened locally.
- PR #68 now contains the signed entitlement issuer (`issue-offline-entitlement`), client ES256 verification, device-key binding, 35-day maximum lease with a bounded renewal grace, offline session fallback after successful device preparation, and an entitlement gate on new Outbox writes. A key-generation script and Sync Center status/renewal UI are included.

## Phase-two page integration currently in PR #68

- Home and tenant selection use the cached catalog when the network is unavailable and show local patient/visit/test counts.
- Reception queues patient creation, visit intake, first payment and same-branch payment collection. Local visits and tests are joined back to cached patient data for the results worklist.
- Results save draft values to IndexedDB, restore them after reload, support a local approval intent pending server validation, and keep final publication/WhatsApp online-only.
- Report preview reads cached visit/patient/results/range overrides. Every print while offline is a watermarked working copy, even if an earlier approved report is cached.
- Printed-copy handoff can be recorded locally and later written as an idempotent audit event; it is not report publication.
- Workday opening, expenses, collections and closing can be queued locally. A queued close depends on all prior branch operations and is reconciled against the server's collected/expenses/net-cash snapshot.
- Owner dashboard shows a local-only summary for cached visits, tests, cash movements and pending sync operations; receivables, Excel reconciliation and full financial reports remain cloud-only.
- Settings, staff and expense categories can be read from local cache. Changes to cloud configuration remain online-only.
- Sync Center displays entitlement state, preparation readiness, storage health and queued operation state.

## Database and CI evidence

- PR #35 added migrations `074_offline_draft_results_idempotency` and `075_offline_culture_idempotency`; those migrations are present in the current primary project's migration history.
- The current designated TEST project `teba-lab` is **not ready for offline integration testing**: it has only 12 recorded migrations, and read-only schema checks found no `staff_directory`, `test_prices`, `private.can_access_branch`, or offline idempotency RPCs. Do not apply isolated offline migrations to this incomplete schema.
- The primary project has the full current migration history, including 074/075 and later migrations, but it must not be used for test mutations.
- The earlier base commit `6a97eeb9` passed all five CI checks. Its browser QA opened the service-worker shell, disconnected the browser, reloaded it, and verified IndexedDB persistence plus Outbox idempotency. This is a local browser acceptance test, not a live Supabase sync test. New CI results must be checked again after the entitlement changes.
- Read-only security inspection of the primary database found `private.offline_operation_receipts` has RLS disabled. The same inspection found no direct SELECT/INSERT grants for `anon` or `authenticated`, and the receipt-writing RPCs are `SECURITY DEFINER` functions owned by `postgres`; therefore this inspection does not establish public table access. It remains a security-hardening item: do not enable RLS or add policies blindly; confirm the intended function-only access path and migration behavior first.

## Still not complete — do not represent as production-ready

1. **Signed offline entitlement:** implementation is present in PR #68 but is not active yet. The public JWK remains intentionally unset and the private key has not been provisioned in Supabase Edge Function Secrets. Run `scripts/generate-offline-entitlement-key.mjs` locally, commit only the generated public JWK, and store the private JWK under `OFFLINE_ENTITLEMENT_PRIVATE_JWK` in the project Edge Function Secrets. The connected project tools do not expose secret provisioning, so no secret was created or exposed here. Do not merge or claim entitlement activation until the key is configured and the endpoint is runtime-tested.
2. **Authenticated runtime acceptance:** no live clinical account test has yet demonstrated disconnect after preparation -> browser reload/restart -> local read/write -> local backup/restore -> reconnect -> exact-once server acknowledgement -> retry after lost response -> tenant/branch isolation. The designated TEST database must first be brought to a compatible schema or replaced with an isolated development branch.
3. **Official final report while offline:** offline print is deliberately provisional. The local approval intent is pending server validation and does not create a final server approval, reviewer signature or publication record. The server revalidates the clinical fingerprint on reconnect; final patient-portal publication and WhatsApp remain online-only.
4. **Other clinical status changes:** result corrections, parameter-range edits and direct test-status changes remain online-only. Local approval is the only queued approval intent and is reconciled through the existing atomic server approval function.
5. **Attachments and portal operations:** uploads, patient portal lookup and WhatsApp publication remain online-only.
6. **Cross-device recovery:** IndexedDB is device-local. A local queue cannot appear on another device until synchronized. A local backup can preserve queued operations, but moving it to another device requires restore and subsequent authenticated synchronization.

## Required entitlement behavior

- The server issues a signed, tenant/user/branch-scoped offline token only after verifying active membership, branch access, tenant status and the current trial/subscription period.
- The offline lease may cover up to 35 days to support the customer's once-at-start/once-at-end monthly connection pattern, but cannot extend beyond the paid period plus the configured renewal grace.
- After token expiry, block only creation of new offline business operations. Keep local records readable/exportable and retain every queued operation.
- On reconnection, synchronize and obtain server acknowledgement for pending operations before applying restrictions to new operations.
- Subscription expiry must not prevent login for data export, access to historical records, recovery or pending sync.
- Never gate `syncOutbox` on subscription state.

## Next gated work

- Generate the ES256 key pair locally, commit only the public verification JWK, provision the private JWK in Edge Function Secrets, deploy the issuer and runtime-test renewal. The repository currently contains no private key and the issuer has not been deployed.
- Deploy and runtime-test the work-copy delivery audit Edge Function in a safe environment; it has not been deployed.
- Obtain fresh CI results for the current PR head. The previous CI run was on an earlier commit; no current-head result is available yet.
- The owner must perform real isolation acceptance on a compatible isolated TEST environment: disconnect/reload, local reception/results/workday/cash/print, backup/restore, reconnect, lost-response retry, exact-once acknowledgement and cross-tenant/branch isolation. The legacy TEST project is incompatible and no paid isolated branch was created.
- Do not apply migrations, deploy functions or change production data as part of this PR without a separate explicit authorization.
