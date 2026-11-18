# Batch 16 — Unified application launcher and integration pass

## Added
- Added `app/index.html` as the unified Arabic RTL entry point for the tenant application.
- Added a responsive launcher UI with sign-in, tenant/branch context selection, connection state, and navigation cards.
- Navigation visibility follows the authenticated membership type: reception, results, workday and sync are shown to owner/staff; financial dashboard and CMS are shown only to tenant owners.
- The launcher reads tenant and branch memberships from the authenticated context resolver. It does not treat localStorage or URL values as authorization.
- Added a visible fail-closed configuration notice and disabled login when the TEST publishable key is missing. `config/environment.js` remains intentionally unconfigured.
- Added a return-to-home link on all application pages.
- Updated service worker cache to v2 and expanded the app shell to include every current application screen, stylesheet, script and local module required by those screens.
- Changed offline navigation fallback to the unified launcher. Supabase API responses remain excluded from cache.
- Added static integration tests for launcher role visibility, navigation and service-worker assets.

## Validation
- `node --test tests/static/*.test.mjs`: 67 passed, 0 failed.
- `node --check` passed for all authored JavaScript files and `service-worker.js`.
- Local relative JavaScript imports and HTML assets: 0 missing paths.
- Service worker local app-shell paths: all exist.
- Source-original manifest SHA-256 comparison: all 31 files match.
- ZIP integrity check passed after packaging.

## Not verified
- No live Supabase login or RLS test; TEST publishable key remains blank.
- No browser-authenticated visual QA or role-switching test against real accounts.
- The attempted headless browser screenshot did not complete in this environment; no visual fidelity percentage is claimed.
- The launcher controls navigation visibility only. Database RLS and guarded RPCs remain the actual authorization boundary.
- Migrations 001–007 have not been executed against TEST in this workflow; do not deploy this workspace to production.
- Full cloud backup/restore remains unimplemented; Batch 15 only provides a scoped local-device backup.

## Important operational boundaries
- No tenant has been created for Taiba.
- The production Supabase project and `source_original/` have not been modified.
- The patient portal Edge Function and report publication Edge Function still require deployment, secrets, allowed-origin configuration and live security tests.
- Offline result entry, approval, report publication/correction and workday open/close remain intentionally online-only.

## Recommended next phase
This completes the planned 16 development batches, not production readiness. Next is a controlled TEST integration phase: apply migrations in order, configure only the TEST publishable key, create disposable test identities/tenants, test two-tenant and branch isolation, verify every workflow, deploy Edge Functions to TEST, and run a full backup/restore drill. Only after passing those gates should hosting and Taiba onboarding be considered.
