# Batch 12 — Owner dashboard and monthly financial view

## Added
- `app/dashboard.html`: Arabic RTL owner dashboard with tenant, branch and month filters.
- `assets/css/dashboard.css`: responsive dashboard styling.
- `assets/js/dashboard.js`: owner-only UI gate, monthly report rendering and copyable month summary.
- `dashboard/repository.js`: monthly report data access and aggregation.
- `tests/static/owner-dashboard.test.mjs`: dashboard contract tests.

## Financial definitions used
- Collections are actual inflows from `financial_ledger`, not invoice face value.
- Expenses are actual outflows from `financial_ledger`.
- Net cash is collections minus recorded expenses. It is not labeled accounting profit.
- Gross billed, discounts and net billed are separate values from `visit_billing`.
- Receivables are calculated for visits opened in the selected month as net invoice value less all payments received for those visits through the time of the report.
- Branch comparison is available for all branches or one selected branch.
- Daily movement follows `financial_ledger.work_date`, preserving the manually opened workday convention.
- Test movement uses `visit_tests` snapshots and is not presented as per-test profit.

## Important limitations / not verified
- No cost-of-test master data or unit-cost snapshot exists in the current schema. Per-test margin, contribution, and BCG profitability are intentionally not fabricated and remain a future dependency.
- Salaries, rent, utilities and other overheads are not yet fully modeled as monthly cost allocations. Therefore net cash is not net profit.
- The dashboard was not run against a live Supabase account because the test publishable key remains intentionally blank.
- RLS isolation and manager-vs-employee financial access were not live-tested. The page hides the dashboard from employee accounts, but UI gating is not a substitute for database authorization.
- No database migration is required for this batch.
- This is a new screen; it does not replace legacy dashboards or spreadsheets.

## Validation
- Static tests cover the source contracts and labels only.
- Browser rendering, live query behavior, tenant isolation, and data reconciliation remain unverified.
