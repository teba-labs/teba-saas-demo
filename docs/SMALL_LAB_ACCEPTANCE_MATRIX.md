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
- Catalog bootstrap RPC and client call are implemented in migration 105/repository. A rollback-only SaaS TEST rehearsal returned 45 available verified Core tests, installed 43 missing definitions on first call, installed 0 on the second call, and left the database unchanged after rollback (3 catalog rows / 3 links remain).
- Results workbench calls the atomic per-test completion RPC after saving complete results; visit-level approval remains guarded by the existing atomic all-required-results RPC.
- Partial report preview is limited to individually completed tests and is visibly marked partial; the visit remains open.
- Result correction no longer prompts for a typed reason; it sends a fixed system audit label and stores authenticated user/staff identity. Migration 107 permits owner correction of approved unpublished results while keeping employee restrictions.
- Profile reports are given page breaks; physical printer verification is still outstanding.

## Explicit blockers / not yet verified

- Migrations 105–107 are in the PR only and have **not** been applied to SaaS TEST or production.
- No Netlify preview credentials are configured; no live preview URL is available from this PR.
- No signed-in end-to-end customer session has been tested.
- The expanded 495-definition index remains needs_review / local_verification_required; it is not part of automatic provisioning.
- Core reference intervals requiring local verification remain flagged; do not represent them as locally validated.
- CBC, urine, stool, culture, formula/conditional entry, physical print output, offline sync under interruption, patient portal/WhatsApp delivery and full RLS negative tests still need execution evidence.
