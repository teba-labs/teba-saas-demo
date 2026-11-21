# Batch 73 — Platform subscription period controls

## Delivered in source
- Added date controls for trial expiry and subscription expiry in the platform tenant cards.
- Preserves existing values returned by `platform_list_tenants`.
- Saves tenant state, plan, subscription state, trial end and subscription end through one atomic platform-admin-only RPC.
- The RPC rejects unsupported states, inactive plans and a subscription end date earlier than the trial end date.

## Not included
- No payment gateway, invoices, receipts, payment reconciliation or automatic recurring collection.
- No automatic entitlement enforcement has been connected to these metadata fields.
- Migration 072 has been added to the repository but has not been applied to the TEST Supabase project in this step. The new controls must not be used against a database until that migration is applied and verified.
