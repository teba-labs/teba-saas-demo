# Batch 14 — Platform administration console

## Delivered
- Added a separate Arabic RTL platform console at `app/platform-admin.html`.
- Added plan management UI for plan code/name, monthly price, active state, limits JSON and features JSON.
- Added tenant onboarding by an already-registered owner email. The platform console does not create passwords or use the Auth Admin API from the browser.
- Tenant provisioning runs in a single database RPC transaction: tenant, owner membership, base lab settings, site settings, usage row, and initial trial subscription.
- Added tenant and subscription status management through a single atomic RPC.
- Added aggregate platform overview: tenant name/slug/status, branch count, aggregate patient and visit counts, storage bytes, subscription status and plan name.
- Platform RPCs fail closed unless `private.is_platform_admin()` is true.
- Platform tenant listing deliberately excludes patient names, individual visits, test results, reports/PDF paths, invoices, payments, and financial ledger entries.
- No tenant was created and no platform administrator was bootstrapped by this batch.

## Database migration
- `database/migrations/006_platform_admin_console.sql`
- Apply only to the TEST Supabase project after migrations 001–005.
- Creates guarded RPCs for platform tenant listing, tenant provisioning by existing owner email, tenant status update, subscription update, and atomic tenant+subscription state update.
- RPC execution is revoked from `public` and `anon`, and granted to `authenticated`; each RPC checks platform-admin membership server-side.

## Validation
- Static tests cover screen structure, authorization guards, tenant provisioning prerequisites, exclusion of clinical data from platform list RPC, and platform-only operations.
- Browser/Supabase runtime, PostgreSQL migration execution, Auth email lookup, RLS behavior and multi-tenant isolation have not been live-tested.

## Important limitations
- Owner must first register their Auth account using the intended email. This batch does not send invitations or create Auth users.
- Subscription plan prices and limits are administrative metadata; payment collection/invoicing and automatic subscription billing are not implemented.
- Storage/patient/visit usage counters depend on accurate maintenance of `tenant_usage`; no new usage-metering triggers are introduced here.
- Platform admin can manage tenant and subscription metadata, but this console intentionally does not provide a support-data access/break-glass workflow.
- The console does not register Taiba as a tenant.
