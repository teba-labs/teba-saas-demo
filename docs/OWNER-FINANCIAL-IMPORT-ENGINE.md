# Owner Financial Import Engine

## Scope
This implementation is isolated to the accountant import path, its financial repository/engine, tests, and one Supabase migration. It does not change reception, patients, tests/results, printing, patient portal, general permissions, offline sync, or global CSS.

## Supported source files
- XLSX, XLS, XLSM, ODS, CSV, TSV.
- XLSM VBA is not loaded or executed (`bookVBA: false`).
- PDF/OCR is intentionally not part of this cycle.

The workbook reader walks every worksheet in sequence. Header detection scans the first 100 rows, prefers recognized financial labels, and preserves the real source row number. Sheet classification is a suggestion only; unknown columns remain available for explicit mapping.

Arabic-Indic/Persian digits, Arabic decimal/thousands separators, day-first dates, and full ISO dates are normalized. A valid subset of rows can be imported while incomplete rows remain visible in the validation report. Mixed detail sheets exclude identifiable total rows; summary-only sheets remain usable.

## Import and revision lifecycle
- The original workbook is stored once per upload under the tenant's private `tenant-backups` storage path; each worksheet batch references the same object.
- Every worksheet keeps its mapping snapshot, sheet summary, source row references, skipped counts, and imported rows.
- New dated rows are stored with `pending_approval=true` and `is_active=false`. They do not alter approved dashboard values.
- Re-imported identical rows are skipped by tenant/branch/period/metric/item/category/currency identity.
- Changed rows become pending revisions. On approval, the new revision is activated and matching old rows are retained but deactivated.
- Detail rows take precedence over matching summary totals for the same period, metric, currency, and branch.
- By default, approval merges changed/new row identities while preserving unrelated rows. An explicit full-period replacement checkbox replaces the month for branches that have pending rows, while preserving prior rows in the archive.

## Approval and dashboard
- A full-year review displays yearly totals and month-by-month totals.
- The owner chooses the source for each metric: historical accountant archive or current operational data.
- One year approval writes the corresponding monthly approval records so existing monthly dashboard consumers can apply the year immediately.
- A tenant-wide approval is also honored when viewing an individual branch; a branch-specific approval takes precedence.
- Historical and live values are selected per metric, not added together, avoiding double counting.
- Current operational data remains sourced from the existing financial ledger, expenses, visits/billing, and payments paths.

## Upload path consolidation
The previous fixed-template historical workbook panel no longer accepts new uploads. Existing saved legacy workbooks and their historical analysis remain available, and the old archive's local/cloud synchronization and deletion controls remain available. New uploads use the unified accountant importer; duplicate legacy upload controls are removed.

## Database and security
Existing tables are reused:
- `owner_financial_import_batches`
- `owner_financial_import_rows`
- `owner_dashboard_source_settings`
- `owner_dashboard_month_approvals`

Migration `20261128150000_owner_financial_row_activation.sql` adds row activation/revision flags and the owner-checked `activate_owner_financial_import_period` RPC. Existing tenant-owner RLS is retained. No migration has been applied to production Main.

## Changed files
- `assets/js/dashboard-financial-import.js`
- `modules/dashboard/financial-import-engine.js`
- `dashboard/owner-financial-repository.js`
- `supabase/migrations/20261128150000_owner_financial_row_activation.sql`
- `tests/unit/financial-import-engine.test.mjs`
- `tests/static/owner-financial-import.test.mjs`

## Verification boundary
The GitHub static/unit, static regression, and responsive contract workflows are run against this branch. Applying and exercising the Supabase migration requires a separate development database branch; this is not performed against production Main. PDF OCR and cross-currency conversion are not implemented in this cycle.
