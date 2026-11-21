# Owner Dashboard — Generic Financial Archive Handoff

## Goal
The owner dashboard keeps two independent data tracks:
1. Live operating records from the lab workflow.
2. Historical/accountant workbooks imported by the owner.

The historical archive can power the historical reports when live data is empty. Imported rows are never converted into visits, invoices, payments, or live ledger movements.

## Generic workbook support
- No fixed workbook type names, sheet names, year list, or year limit.
- Excel (.xlsx, .xls) and CSV files; workbook size limit 20 MB.
- Sheet-by-sheet import. Re-select the same workbook and choose another sheet to import it; each sheet is independently idempotent.
- Automatic column suggestions with manual mapping and a five-row preview.
- Wide monthly/yearly sheets: separate columns for revenue, collections, expenses, cases, discounts, and test counts.
- Normalized movement sheets: date + movement type + amount/quantity + optional test/category.
- Separate year and month columns, or a full date/month column.
- Timeless test price sheets: test name + unit cost and/or selling price + optional cost-allocation weight.
- Optional branch column matched exactly (case-insensitive) to the tenant's branch names, or a single branch can be selected for the sheet.
- Original workbook is preserved in the private tenant-backups bucket; original source cells and mapping snapshot are also stored with imported rows.

## Validation and duplicate handling
- Rejects invalid dates, missing financial measures, unrecognized branch names, and malformed numeric values.
- Detects duplicates within the workbook and exact duplicates across prior imports.
- Detects same-period/same-branch/same-item conflicts, including changed unit cost, selling price, and allocation weight. Ambiguous rows are skipped and counted rather than silently replacing prior data.
- A repeated workbook sheet is blocked by its content hash + sheet name.
- Database row writes are chunked; on a failed batch, imported rows, batch metadata, and the just-uploaded source file are rolled back.

## Historical analysis
- Annual and monthly revenue/expense/case summaries.
- Profit/loss and margins.
- Test counts, selling price, direct cost, cost-allocation weight, fixed-cost-per-point, allocated true unit cost, true unit profit, and total test profit.
- BCG portfolio, top sellers, most profitable, least profitable, low-demand, and loss-making tests.
- Month-of-year seasonality and a three-month outlook based on prior observations for the same calendar months. The plan is an arithmetic historical average, not a guaranteed forecast.
- The generic results are injected into the existing historical owner report slots so the 18 report navigation entries and their existing visualizations are preserved.

## Live / Excel source selection
Each supported dashboard metric has a tenant-level source setting (live or excel). A selected Excel metric overrides only that metric in the owner dashboard's selected period and branch; no automatic addition of both sources occurs. Derived net cash is recalculated from the selected collection and expense sources.

The monthly approval record stores source selections, an immutable reconciliation snapshot of the selected month, reviewer identity and timestamp, and reviewer notes.

The approval snapshot compares revenue, collections, expenses, cases, discounts, and test counts. The UI requires the dashboard's selected month to match the month being approved.

## Database and security
- Migration 069: archive batches, archive rows, per-metric source choices, and monthly approval snapshots.
- Migration 070: weighted cost-allocation field for test price lists.
- All four new public tables have RLS enabled and forced.
- All policies require private.is_tenant_owner(tenant_id).
- Archive rows carry tenant scope and a composite tenant/branch foreign key.
- Source files use the existing private tenant-backups bucket and its owner-scoped first-folder policies. Upload uses INSERT only (no storage upsert requirement).

## Validation performed
- GitHub Actions static contracts, browser build, and unit/static regression suite: 252 passed, 0 failed (run 44910544196).
- Migration 069 applied to TEST project teba-lis-demo only; RLS/force-RLS confirmed on all four new tables.
- TEST project is PostgreSQL 17.11; existing tenant-backups bucket and tenant-owner INSERT/SELECT/DELETE policies confirmed.
- Security advisor scan returned no findings on these four new tables. Existing unrelated project-wide advisor findings remain unchanged.
- Production database has not been modified.
- main has not been modified or merged.

## Remaining acceptance boundary
Before merge or production rollout:
1. Confirm migration 070 on TEST and verify the added weight column.
2. Run the final full CI suite after the weighted-cost changes.
3. Perform authenticated browser QA on TEST: upload a wide workbook, a normalized workbook, a timeless test-price sheet, and a second sheet from the same workbook; verify source switching, branch isolation, reconciliation snapshot, and historical report cards.
4. Confirm all expected source columns in real customer workbooks before making any financial KPI a trusted accounting result.