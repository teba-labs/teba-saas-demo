# Offline and Outbox — source findings

Static inspection of the preserved legacy source confirms that the same Dexie database (`TebaLabOfflineDB`, schema version 4) and Outbox processor are duplicated in `system/lab.js`, `system/reception.html`, and `system/tests_manage.html`.

Observed risks requiring redesign before reuse:
- Outbox processing is implemented separately in multiple screens, so behavior can drift.
- Some delete requests to Supabase are awaited without checking the returned `{ error }` before the local Outbox item is deleted.
- The legacy queue includes operations/table names (`orders`, `orders_edit`, legacy `visits` fields) that do not directly match schema v1.0.
- Legacy result writes use a JSON payload (`results_data`) that does not match the normalized `test_results` + parameter model in schema v1.0.

No old queue data is migrated or deleted in this pass. The new offline engine must be built with stable operation IDs, tenant/branch scope, dependency ordering, idempotent server acknowledgement, and explicit conflict handling. Financial and published-result operations require domain-specific conflict rules.
