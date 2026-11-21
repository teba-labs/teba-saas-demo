# Offline Results and Subscription Entitlement — Delivery Status

**Working branch:** `feature/offline-entitlement-completion-2026-11-21`  
**PR:** #35 (draft; do not merge)  
**TEST project:** `teba-lis-demo`

## Implemented in this tranche

- Draft-result batches can be saved to the local IndexedDB outbox when the browser is offline or a network request fails.
- Every batch gets a stable UUID before the first request. If the server committed but the response was lost, retrying with the same UUID returns the original result rows rather than inserting duplicates.
- The server receipt is scoped by tenant, branch and operation UUID, and bound to the authenticated user and exact payload. The receipt table is in the private schema and has no client grants.
- The results workbench restores pending local values after rerender/reload, visibly marks them as waiting for sync, and blocks test completion and visit approval while a local draft write remains unsynced.
- The results workbench starts branch-scoped background sync and refreshes after the server confirms queued writes.
- Previously loaded worklist pages, staff identities, result values, culture-isolate reads and susceptibility reads are cached for offline review.
- Culture isolate and susceptibility writes remain explicitly online-only; no fake local-save confirmation is shown.
- Outbox acknowledgement contains no subscription/expiry gate. Pending operations are not discarded because a subscription expires.

## TEST and CI evidence

- Migration `074_offline_draft_results_idempotency` was applied to TEST.
- Verified the RPC exists, the private receipt table exists, `anon` cannot execute the RPC, and `authenticated` can execute it.
- GitHub Actions run 1154: JavaScript module check passed, browser-only build passed, static/unit tests **277/277 passed**, source packaging and artifact upload passed.
- This is automated/static validation. It is not a live authenticated clinical write test.

## Explicitly not complete

- The seven-day signed offline entitlement has **not** been implemented or enforced. No subscription lock has been added to reception or result entry.
- New offline visit registration is already queued by the reception workflow, but a newly queued visit is not yet projected into the results worklist until its intake operation has synchronized.
- Offline culture isolate/AST writes, range corrections, result completion, visit approval, report correction/publication, attachments and portal operations remain online-only.
- Worklist caching is limited to pages previously loaded online on that device; it is not a full offline mirror of all visits.
- No browser-only mechanism can make clock rollback absolutely tamper-proof. A signed token plus local anti-rollback checks is a deterrent, not equivalent to secure hardware storage.
- A private signing secret and pinned public key have not been provisioned. The current connected Supabase tools do not expose project-secret management, so a signing key must not be invented, committed, or placed in client code.

## Required entitlement behavior before launch

1. The server issues a signed, tenant/user/branch-scoped offline token only after verifying membership and the current trial/subscription period.
2. Token expiry is bounded by the earlier of the subscription end and the configured offline grace period (default 7 days).
3. After token expiry, block only creation of new offline business operations. Keep local records readable/exportable and retain every queued operation.
4. When connectivity returns, synchronize and obtain server acknowledgement for queued operations **before** applying any new-operation subscription restriction. Never reject or delete an already-created pending operation solely because the subscription expired while offline.
5. Subscription expiry may restrict new online registration after reconnection, but must not prevent login for data export, access to historical records, recovery, or pending sync.
6. Completion, approval, correction and publication remain server-validated online operations; do not queue clinical sign-off offline until their audit, locking and conflict semantics have a separately tested design.

## Next engineering tranche

- Implement and test the signed offline entitlement endpoint and client verifier after a secure private signing secret can be provisioned.
- Add a narrow, explicit gate to new reception operations only; do not gate `syncOutbox` or read/export paths.
- Add offline projection of newly queued intake records into the local worklist, with dependency ordering (patient -> visit intake -> draft results).
- Extend offline queue semantics to culture isolate/AST writes only after server idempotency and clinical audit rules are in place.
- Run authenticated TEST scenarios for: offline result save, browser reload, duplicate retry after lost response, sync after grace expiry, and subscription expiry with pending data.
