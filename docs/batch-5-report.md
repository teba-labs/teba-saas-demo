# Batch 5 — Reports, Settings, Staff and Dashboard foundations

Implemented:
- Report-version listing and short-lived signed downloads for authenticated staff against the private `tenant-reports` bucket.
- Explicitly withheld browser-side publish/correction actions. The report upload, immutable version insert and visit publication must be atomic on the server; the current schema does not provide a single publication RPC/Edge Function.
- Tenant laboratory settings read/update, with owner-only enforcement delegated to database RLS.
- Branch staff-name directory read/create/deactivate, with owner-only maintenance delegated to RLS.
- Branch-scoped operational snapshot and expense retrieval for dashboard foundations. Collected revenue is computed from payments, not invoice totals.

Not implemented/verified:
- Patient portal lookup. The schema explicitly requires a rate-limited Edge Function; anonymous direct reads are prohibited.
- PDF rendering/upload and atomic publication/correction.
- Financial monthly reconciliation/BCG analytics, CMS editor and full settings UI.
- Live browser/RLS/RPC tests. These repositories are not wired to screens yet.
