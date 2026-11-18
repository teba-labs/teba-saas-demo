# Taiba Smart Lab — Phase 1 Pending Work

Updated: 2026-11-18  
Scope: `teba-saas-demo` and the new Supabase TEST project only. The legacy `teba-lab` repository and old Supabase project are out of scope.

This is the working deferred-task register. Items are not considered complete unless an execution result or test evidence is recorded.

## Immediate gate — before tenant onboarding

- [ ] **P0 — TEST database backup/export:** take a recoverable backup of the TEST project before applying the consolidated migrations.
- [ ] **P0 — Apply migrations 002–011:** use the reviewed consolidated SQL deployment file; do not rerun migration 001. The SQL has been prepared locally but has **not** been executed against Supabase.
- [ ] **P0 — Review deployment result:** require all in-script post-flight assertions to pass; capture the returned deployment summary. If it fails, stop and preserve the exact error.
- [ ] **P0 — Confirm platform-admin identity:** verify that the existing platform-admin row belongs to the intended trusted platform-owner Auth account. Do not create or promote another account without explicit approval.
- [ ] **P0 — Live tenant-isolation test:** test two separate test tenants and verify that neither tenant can read or mutate the other's patients, visits, results, files, staff, or financial records. Static tests are not a substitute.

## First real workflow — Taiba as the pilot tenant

- [ ] **P1 — Create Taiba tenant:** only after the database deployment and security gate pass.
- [ ] **P1 — Create branches:** Gaafara and Bahtim, with correct tenant and branch memberships.
- [ ] **P1 — Create staff identities and branch permissions:** verify owner, manager, reception, lab, and read-only permissions as applicable.
- [ ] **P1 — End-to-end workflow:** open workday → patient → visit/intake → payment → results → approval → report publication → report correction with reason → expense → workday close.
- [ ] **P1 — Cash replay tests:** simulate ambiguous commit/retry, repeated operation IDs, same operation from two tabs/devices, and retry after staff deactivation or workday closure.
- [ ] **P1 — Offline dependency tests:** patient creation must sync before dependent visit intake; verify conflict visibility and no silent operation loss.

## Security, files, and recovery — before external customer launch

- [ ] **P0 — Storage isolation:** verify private buckets, tenant-scoped object paths, Storage RLS policies, and cross-tenant denial.
- [ ] **P0 — Report publication live test:** deploy and test the authenticated Edge Function, PDF upload, atomic publication RPC, private download, and orphan cleanup on failure.
- [ ] **P0 — Edge Function validation:** TypeScript type-check, review JWT verification, confirm service credentials remain server-side, and test failure paths.
- [ ] **P0 — Backup and restore:** verify cloud database backup/restore and Storage recovery per tenant. Local IndexedDB backup alone is not sufficient.
- [ ] **P1 — Browser/device QA:** test supported desktop/mobile browsers, offline/online transitions, multiple tabs, refresh, and sync conflict handling.
- [ ] **P1 — RLS regression matrix:** execute the manual matrix in `database/tests/manual_rls_test_matrix.md` using separate test identities and tenants.

## Deferred non-blockers

- [ ] **P2 — Documentation refresh:** update README and installation notes after the deployment workflow is stable; documentation cleanup must not block functional testing.
- [ ] **P2 — UI polish/accessibility:** visual refinements and accessibility pass after core workflows are verified.
- [ ] **P2 — Usage/storage alerts and subscription refinements:** validate limits and operational alerts before commercial rollout.

## Evidence recorded so far

- Batch25 static test suite rerun: **104 passed, 0 failed**.
- JavaScript syntax checks previously rerun: **71/71 passed**.
- TEST database diagnostic supplied on 2026-11-18: 46 public tables; all 46 had RLS enabled and FORCE RLS; 87 policies; 43 triggers; 29 functions; 1 Auth user; 1 platform admin; 0 tenants; 0 branches; 0 tenant memberships.
- `schema_migrations` showed only baseline version `1.0.0`. This table does not prove migrations 002–011 were installed.
- Migration markers indicated the baseline schema exists, while most post-baseline changes were absent. The consolidated 002–011 SQL is prepared locally, but **no SQL has been run against the live TEST database by the assistant**.
- No live PostgreSQL, Supabase Storage, Edge Function, browser, or cross-tenant RLS test is claimed complete.

## Change log

- 2026-11-18: created the phase-one pending-work register from the Batch25 review and TEST database diagnostics.
