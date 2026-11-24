# Taiba Smart Lab — Small Laboratory Acceptance Matrix

This is the acceptance checklist for the small-laboratory operating model. It is not a claim that all items are complete. Every item must pass its stated workflow test before the PR is merged.

## Product acceptance

1. **Tenant onboarding:** a newly created lab receives its tenant, owner, default branch and workspace without manual technical setup. Verify with a newly provisioned test tenant.
2. **Automatic catalog:** on first authenticated workspace/catalog load, provision the published clinically reviewed Core release automatically. Refresh must not require logout/login or manual import; repeated calls must be idempotent. Tenant prices remain private and must never be copied from another lab.
3. **Home screen:** reception staff see daily actions only; owner-only dashboard and settings remain hidden from staff.
4. **Patient intake:** patient phone is optional; date of birth is optional and calculates age when supplied; age unit remains available when DOB is absent. Enter/Tab navigation must reach every field and save action.
5. **Test ordering:** search and select individual tests/profiles quickly; prices and selected tests are visible before saving.
6. **Billing:** support full/partial payment, cash/electronic methods, outstanding balances, later collections and patient account statement.
7. **Workday/cashier:** open/close workday, record receipts/expenses/withdrawals and reconcile closing balance.
8. **Results workbench:** keep visit list, individual tests and profiles in the workbench; open entry in a same-screen modal and preserve entered values when returning.
9. **Result entry:** support numeric, text, choice, multi-choice, conditional fields, derived values, CBC, urine, stool and culture workflows.
10. **Clinical definitions:** use verified source-backed parameters and formula definitions; never invent units, methods, reference intervals or decision limits. A test may be available while its local reference interval remains flagged for local verification.
11. **Correction:** authorized users can correct a saved result without typing a reason; the authenticated user/staff identity is recorded automatically. Published report versions remain auditable.
12. **Partial completion:** each fully completed test can be completed independently; the visit stays open while other tests are pending. Visit-level approval still requires all required visible results.
13. **Reports:** print completed tests as a clearly marked partial report; keep unfinished tests out of that report. Final report includes all completed tests, all individual tests together, and each profile on a separate page. Preview before print.
14. **Visit lifecycle:** find old visits, continue unfinished tests, distinguish pending/completed/published, and retain history.
15. **Lab settings:** identity, branch details, print settings, logo, header/footer and report preferences persist and are reflected consistently.
16. **Permissions:** owner has tenant-wide access; staff are restricted to assigned branch and operational tasks. Tenant and branch RLS isolation must pass negative tests.
17. **Offline:** core intake/result operations remain available offline; queued changes sync once, with conflict visibility and no duplicate visits/results.
18. **Optional patient channels:** patient portal and WhatsApp can be disabled without affecting reception, result entry, approval or printing.
19. **Owner dashboard:** revenue, expenses, cases, collections, balances and branch summaries use reconciled operational data.
20. **Release QA:** signed-in customer workflow, mobile/responsive QA, print tests, RLS isolation, sync/idempotency and migration rehearsal all pass before merge.

## Current implementation in this PR

- Phone is optional; DOB field and age calculation are implemented in the reception UI/repository, pending migration 106.
- Reception owner can enter a missing tenant price inline; no other lab's price is copied.
- Catalog bootstrap RPC is called on workspace load/refresh. The workspace warms the test catalog and parameter cache after the first online load, so no logout/login or manual import is required. A rollback-only SaaS TEST rehearsal returned 45 available verified Core tests, installed 43 missing definitions on first call, installed 0 on the second call, and left the database unchanged after rollback (3 catalog rows / 3 links remain). All 45 Core tests have specimen/method/category metadata and 352 parameter rows; 11 parameters are calculated.
- Results workbench calls the atomic per-test completion RPC after saving complete results; visit-level approval remains guarded by the existing atomic all-required-results RPC.
- Partial report preview is limited to individually completed tests and is visibly marked partial; the visit remains open.
- Result correction no longer prompts for a typed reason; it sends a fixed system audit label and stores authenticated user/staff identity. Migration 107 permits owner correction of approved unpublished results while keeping employee restrictions.
- Partial reports contain only completed tests and are labelled partial. Migration 108 and the UI block patient-portal publication until every requested test is complete.
- The patient portal is optional and defaults off for newly created lab settings. Both the public lookup endpoint and the report-publication RPC check the owner's enabled setting; printing and laboratory operations remain available when it is off.
- First-time portal settings now use an owner-scoped upsert because a newly created test tenant may not yet have a `site_settings` row. A rollback-only authenticated insert verified the new row defaults to portal disabled and records the owner as updater.
- Profile reports are given page breaks; physical printer verification is still outstanding.

## Explicit blockers / not yet verified

- Migrations 105–108 are in the PR only and have **not** been applied to SaaS TEST or production. All four were rehearsed together inside a transaction and rolled back; the database was confirmed unchanged afterward.
- No Netlify preview credentials are configured; no live preview URL is available from this PR.
- No signed-in end-to-end customer session has been tested.
- SaaS TEST RLS was exercised in rollback-only authenticated transactions: owner access returned only its tenant's 2 visits/2 patients; a temporarily linked employee saw 2 visits, 2 patients, 4 visit tests and 18 results in the assigned branch, and zero rows in the other branch. The temporary staff link was rolled back. Only one tenant is currently seeded, so a second real tenant-to-tenant negative test remains outstanding.
- The expanded 495-definition index remains needs_review / local_verification_required; it is not part of automatic provisioning.
- Of the Core numeric parameters, 131 reference intervals still require local verification and 6 have no range. The UI labels proposed source ranges as unapproved locally and does not auto-flag H/L until a range is verified locally.
- CBC, urine, stool, culture, formula/conditional entry, physical print output, offline sync under interruption, patient portal/WhatsApp delivery and full RLS negative tests still need execution evidence.
