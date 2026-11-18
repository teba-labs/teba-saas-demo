# Batch 31 — local archive row and relationship validation

Date: 2026-11-18
Branch: cloud-hardening-2026-11-18
Scope: local-only analysis of workbook rows after sheet and column mapping. No import.

## Added

- Required-field checks per supported entity.
- Duplicate key checks for patient IDs, visit IDs, catalog test codes, ledger IDs, and visit/test combinations when their key columns are mapped.
- Numeric checks for financial amounts, prices, discounts, and ordering values.
- Blank-row counts and preserved physical row positions during worksheet parsing.
- Duplicate column-header warnings.
- Cross-sheet reference checks for visit-to-patient, visit-test-to-visit, result-to-visit, and optional ledger-to-visit relationships.
- UI report with counts and a bounded sample of row-level warnings. The report does not dump full row contents.

## Privacy and safety

- Workbook rows are analyzed in the current browser tab only.
- Raw rows are held in page memory to allow the user to change header rows and column mappings and recalculate checks.
- No browser persistence, Supabase read/write, file upload, import, schema change, Storage policy change, or deployment.
- These are preliminary consistency checks, not clinical validation or approval to import.
- Relationship checks only run when both relevant sheets and required mappings are present. They compare source identifiers as text; they do not create or repair links.

## Tests

GitHub Actions run 44367700931 passed: 136 tests, 0 failures.

Synthetic cases cover duplicate patient IDs, missing required names, invalid monetary values, blank rows, missing patient references, and orphan visit-test references.

## Still not implemented

- Full type/date validation and entity-specific clinical rules.
- Robust duplicate matching for patients with different IDs but similar names/phones.
- Reconciliation of multiple visits/branches and legacy integer branch IDs against target UUIDs.
- Safe transformation of age + age_type without loss.
- Financial ledger semantic mapping and reconciliation with cumulative paid_amount.
- Historical workday creation and conversion of legacy visit IDs.
- JSONB result conversion into parameter snapshots while retaining the original raw payload.
- Deterministic source-to-target IDs, import batches/checkpoints, retries, rollback, and dry-run totals.
- Any real data transfer.
