# Batch 10 — Reception and patient intake

## Added
- `app/reception.html`: separate Arabic/RTL reception page for the new schema.
- `assets/css/reception.css`: responsive mobile/desktop layout.
- `assets/js/reception.js`: authenticated tenant/branch selection, active staff selection, open-workday check, branch-scoped patient search, patient registration, catalog search, test selection, discount/payment preview, visit creation and recent-visit list.
- `database/migrations/004_atomic_visit_intake.sql`: a single database transaction that creates the visit, snapshots selected test prices/technical parameters, creates the invoice and records an optional initial payment. Totals are computed from database snapshots, not trusted from browser values.
- `modules/reception/repository.js`: branch-scoped patient search now queries name and phone separately rather than interpolating user input into a compound PostgREST filter; added `createVisitIntake` RPC client.
- `core/data/schema-contract.js`: registered `create_visit_intake` RPC.
- `tests/static/reception-intake.test.mjs`: static contracts for intake and atomic RPC boundaries.

## Workflow
1. Sign in with a TEST-project account.
2. Choose the authorized tenant, branch and staff-directory name.
3. The screen requires an already-open branch workday; it does not silently open or close a workday.
4. Search for an existing patient inside the selected branch, or create a new patient in that branch.
5. Enter a branch-unique visit number and optional referral/notes.
6. Choose tests that have an active price and at least one active technical parameter.
7. Review gross amount, discount, net amount and optional initial cash payment.
8. Submit through `create_visit_intake`; visit, test snapshots, invoice and first payment commit or roll back together.

## Important implementation notes
- Patient records remain branch-local, matching the agreed workflow; the same person visiting another branch is registered separately.
- The browser shows prices for preview only. The database trigger snapshots current prices and technical parameters, and the RPC computes invoice gross total from those snapshots.
- Visit numbers are typed by staff and protected by the existing unique `(tenant_id, branch_id, visit_number)` constraint. No random or guessed visit number is generated.
- Initial payment currently defaults to cash in the UI. Other payment methods can be added to the UI after the workflow is confirmed.
- Patient creation is a separate action before visit submission. If visit submission fails, the patient record remains available; the visit/invoice/payment transaction itself is atomic.
- This page is separate from legacy reception screens and does not replace or modify files in `source_original/`.

## Required before runtime use
- Apply migration `004_atomic_visit_intake.sql` to the TEST project after migrations 001–003.
- Configure the TEST project's publishable key in `config/environment.js`.
- Confirm active workday, branch memberships, staff rows, catalog prices and technical parameters exist in TEST.
- Test with authenticated accounts and verify branch RLS, duplicate visit number rejection, price snapshots, invoice totals, initial-payment ledger entry and rollback on invalid test/price.

## Not verified
- No browser session or live Supabase request was run; the TEST key remains intentionally blank.
- Migration 004 was statically reviewed but not executed against PostgreSQL.
- No real multi-tenant/branch isolation test, payment-ledger test, or live rollback test has been performed.
- This static test suite does not establish clinical correctness or production security.

## Validation
- `node --test tests/static/*.test.mjs`: 31 tests passed, 0 failed.
- `node --check assets/js/reception.js`: passed.
- `node --check modules/reception/repository.js`: passed.
- Import-path checks and ZIP integrity checks are recorded in `batch-10-validation.txt`.
