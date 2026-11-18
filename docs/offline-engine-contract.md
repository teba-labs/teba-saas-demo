# Offline engine contract — first implementation

- Uses a new IndexedDB database name (`TaibaSmartLabOfflineDB`) so this migration does not alter legacy offline data.
- Every queued operation requires tenant and branch IDs and receives a secure UUID operation ID.
- The sync engine is deliberately adapter-driven; it does not guess legacy-to-new table mappings.
- The engine removes an operation only when its handler returns `{ acknowledged: true }` after a server confirmation.
- Missing handlers, errors, and unconfirmed writes remain queued for retry; conflicts are moved to a dedicated local conflict store.
- Exponential retry delay is bounded to one hour; attempts are capped by the caller's policy.

This is the queue foundation, not yet a complete offline workflow. Domain adapters and server-side idempotency handling still need to be implemented and tested before use with patient/financial data.
