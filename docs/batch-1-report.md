# Batch 1 — Core / Config / Database contract

Status: implemented as a safe foundation; not yet connected to live Auth because the TEST publishable key is not in the supplied files.

Files added:
- `config/environment.js`
- `core/supabase-client.js`
- `core/auth/session.js`
- `core/tenant/context.js`
- `core/data/schema-contract.js`
- `docs/contracts/supabase-v1-contract.md`
- `docs/migration-status.md`
- `tests/static/core-config.test.mjs`

Safety decisions:
- New workspace points only to the agreed TEST project URL.
- No legacy production key copied.
- No service-role key used.
- Tenant and branch context is read from authenticated membership tables, not localStorage.
- RLS is still authoritative; client-side filtering is not treated as a security boundary.
- Original source directory is preserved.
