# Batch 11 — Workday, shift expenses and cash closing

## Added
- `app/workday.html`: Arabic/RTL workday management page.
- `assets/css/workday.css`: responsive layout for phone and desktop.
- `assets/js/workday.js`: authenticated tenant/branch selection, staff selection, open/close workday, expense entry, cash ledger summary and latest closing display.
- `modules/workday/repository.js`: repository methods for workday RPCs, expense categories, expense recording and ledger-based summary.
- `database/migrations/005_workday_cash_control.sql`: ties new payments and expenses to the manually open branch workday; hardens payment/expense RPCs and updates atomic reception intake for initial payments.
- `tests/static/workday-cash-control.test.mjs`: static workflow and database contract tests.

## Key operational behavior
- One open workday per branch remains enforced by the database.
- The operator explicitly opens and closes a workday; crossing midnight does not silently switch its date.
- New partial payments and shift expenses must be recorded against the currently open workday. The database locks that workday row during these operations so a concurrent close cannot race through the same cash movement.
- Ledger dates now come from the associated workday, not the device's calendar date. This preserves the user's shift-close convention.
- The reception RPC was updated so an initial payment submitted with a new visit also receives the correct workday ID.
- Cash summary reads the financial ledger; the browser cannot directly insert, update or delete ledger rows.
- Close action requires a confirmation showing collected amount, expenses, net cash and movement count. Database RPC stores a daily closing snapshot including case/test counts and receivables.

## Migration ordering
Apply migrations `001` through `005` in order on the TEST project. Migration 005 adds nullable workday links to historical payment/expense rows; it backfills them only where a matching branch workday exists. New RPC-created movements require an open workday and receive a workday link.

## Important limitations / not verified
- Migration 005 has not been executed against PostgreSQL/Supabase in this development run.
- No live login, RLS, concurrency, payment, expense, or close/reopen test was performed.
- Existing historical ledger rows are not rewritten by this migration; existing ledger work dates remain as originally recorded. Historical movements without a matching workday can retain a null workday link.
- The close operation is intended as the final shift close; there is no reopen/adjustment UI in this batch.
- The current UI displays cash movement summary and the latest closing, not a full manager reconciliation or monthly approval workflow.
- The staff name is an operational attribution choice, not a distinct login identity; branch accounts remain shared by the agreed design.
- This is a separate new page and does not replace legacy screens.

## Validation
- `node --test tests/static/*.test.mjs`: 36 passed, 0 failed.
- `node --check assets/js/workday.js`: passed.
- `node --check modules/workday/repository.js`: passed.
- Import path validation and ZIP integrity are recorded in `batch-11-validation.txt`.
