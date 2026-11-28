# Owner Financial Import Engine

## Purpose
A flexible historical-finance recovery path for independent laboratories. The importer must not assume a fixed starting year: it discovers the available period from source dates, whether the archive starts in 2005, 1998, or another valid year.

## Supported source files
- XLSX, XLS, XLSM, ODS, CSV and TSV.
- XLSM VBA is not loaded or executed (`bookVBA: false`).
- PDF/OCR and guaranteed interpretation of arbitrary handwritten/free-form documents are not supported yet.

## Workbook-wide inspection
- The user uploads one workbook; all worksheets are scanned together.
- Header detection scans the first 100 rows and prefers recognized financial labels.
- The inspection summary reports sheet count, extracted records, issues, likely duplicates, excluded aggregate rows, empty sheets and the detected date range.
- Each sheet gets a suggested classification and column mapping. The owner may override mappings sheet by sheet before rerunning the full scan.
- Arabic/Persian digits, Arabic decimal/thousands separators, accounting-style negative values, common currency suffixes, day-first dates, ISO dates and Excel date serials are normalized.
- Common free-text movement descriptions (revenue, collections, expenses/purchases, cases and tests) are classified conservatively. Unrecognized text is retained for review rather than guessed into a financial category.
- Detail rows take precedence over identifiable totals when both are present. Incomplete and duplicate rows remain excluded from automatic activation.

## Import and approval lifecycle
- One action imports all understandable sheets from the workbook.
- The original workbook is stored once per upload in the tenant's private `tenant-backups` storage path; sheet batches retain their own mappings, summaries and source row references.
- New dated rows remain pending and do not affect approved dashboard values.
- Identical rows are skipped; changed rows are kept as revisions. Prior revisions remain in the archive after activation.
- A single workbook-level approval activates all pending periods from that workbook, and writes monthly approval snapshots for every detected month.
- The approval action checks that no unrelated pending batch exists in the same month before activating it, preventing accidental approval of another upload.
- Price-only reference rows without dates are retained separately and are not used as dated monthly totals.

## Dashboard and source selection
- Historical archive and live operational data are selected per metric, never blindly added together.
- Historical reports include year/month comparisons, income, collections, expenses, profit, cases, tests, item/cost analysis, seasonality and source traceability.
- Current operational values remain sourced from the existing financial ledger, expenses, visits/billing and payments paths.
- Imported accounting data does not create visits, invoices, patient records or test results.

## Database and security
Existing tables are reused:
- `owner_financial_import_batches`
- `owner_financial_import_rows`
- `owner_dashboard_source_settings`
- `owner_dashboard_month_approvals`

Migration `20261128154529_owner_financial_row_activation.sql` is applied to the user's existing Supabase test project `teba-lis-demo` (`hgqwpykeazuzceeiumjg`). The activation RPC is SECURITY INVOKER, checks tenant-owner authorization, denies anon execution and grants execution to authenticated users. Existing tenant-owner RLS policies are retained.

## Verification boundary
The merged baseline's earlier static and responsive checks and a transactional cloud smoke test were reported as passing. Subsequent direct-to-main importer enhancements must pass the repository's automated checks and browser workflow before the complete upload-and-approval journey is considered verified. No claim of arbitrary-format 100% semantic understanding is made.
