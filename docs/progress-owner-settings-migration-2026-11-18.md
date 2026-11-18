# Development progress — 2026-11-18 (owner settings + migration discovery)

Branch: `cloud-hardening-2026-11-18`
PR: #1 remains a draft; nothing was merged into `main`.

## Delivered in this work session

- Extended `modules/settings/repository.js` with tenant-scoped owner operations for branch listing/create/update/activation, expense-category maintenance, and tenant/branch print-settings persistence.
- Extended `app/settings.html` and `assets/js/settings-center.js` with owner-facing controls for:
  - Branch create/edit/activate/deactivate (no hard deletion).
  - Staff directory names per branch (explicitly not represented as Auth account creation).
  - Expense categories (soft activation/deactivation; no deletion of historic expenses).
  - General or branch-specific print preference JSON.
- Kept all operations scoped by the authenticated tenant context; DB RLS remains the authorization boundary.
- Clarified in the UI that the current report workflow uploads a prepared PDF. Stored print preferences do not currently re-render or alter uploaded PDF files.
- Added static regression assertions for the new controls.
- Fixed stale static assertions: service-worker cache version expectation now matches v5; cross-branch migration assertion handles multiline SQL; payment retry assertion matches the literal regular expression in the adapter.
- CI run `44362486563` completed successfully: 121 tests passed, 0 failed.

## Legacy migration discoveries

- Inspected only legacy schema metadata, constraints, and aggregate row counts; no patient/result content was read.
- Legacy cloud contains separate clinical tables and uses integer branch IDs / integer visit IDs; SaaS uses UUID branch/visit IDs.
- Legacy `test_results.results_data` is a JSON object per visit-test; SaaS requires parameter-level rows with immutable snapshots.
- Legacy has no dedicated payments table; it stores `visits.paid_amount` plus generic `financial_ledger` entries. A faithful financial migration must distinguish real dated inflows from cumulative paid totals; do not invent payment dates or methods.
- Legacy patient age uses `age` + `age_type`; SaaS patient table currently exposes only numeric `age_years`. This requires a lossless conversion/preservation decision before real import.
- Legacy Supabase cloud aggregate snapshot: 4 patients, 4 visits, 18 visit_tests, 9 test_results, 10 financial_ledger rows, 248 catalog tests. These are cloud-only counts and do not prove that offline IndexedDB or separate Excel archives are fully represented.
- Added `docs/legacy-data-migration-map.md` with a proposed source-to-target map, blockers, and a safe import contract.

## Not yet done / not to be claimed complete

- No live UI browser test for the owner settings controls.
- No real employee Auth invitation/provisioning flow.
- No print/PDF rendering integration; only settings persistence.
- No audit-log UI or full data export UI.
- No import preview/parser or import writes.
- No real patient data transfer, file transfer, Storage changes, migrations, or RLS changes.
- No deployment; preview hosting is not configured.
- No production/main merge.

## Next engineering steps

1. Review whether owner settings UI should expose audit log and export after their exact authorization and data scope are verified.
2. Define a lossless age-unit strategy and a financial reconciliation rule for legacy `financial_ledger`.
3. Build a dry-run workbook/archive inspector with all-sheet discovery, column mapping, deterministic source keys, duplicate suggestions, and per-row error reporting.
4. Test the inspector with synthetic/de-identified fixtures before any real patient data is used.
5. Implement secure employee invitation only after the exact Owner authorization, Auth lifecycle, branch membership, and staff-directory linkage are verified end-to-end.

## Follow-on: local archive preflight screen

- Added `app/data-import.html`, `assets/js/data-import.js`, and `modules/migration/workbook-inspector.js`.
- Owner-only screen reads XLSX/XLS/CSV files locally in the browser (20 MB limit, up to 50 sheets), lists every sheet, counts non-empty rows, computes SHA-256, suggests likely header rows, and allows the owner to switch the header-row preview.
- The inspector does not call Supabase, does not upload file contents, and does not save workbook rows. It is a preflight/inspection step only; it does not yet map columns to patients/visits/results or import any records.
- Added it to the owner settings center and Service Worker shell v6.
- Latest CI run `44363666340` passed: 122 tests, 0 failures.
