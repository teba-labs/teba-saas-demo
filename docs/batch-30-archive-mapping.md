# Batch 30 — local archive mapping review

Date: 2026-11-18
Branch: cloud-hardening-2026-11-18
Scope: local browser-only workbook inspection and mapping suggestions. No import.

## What is now available

- Workbook sheet classification suggestions for patients, visits, visit tests, test results, financial ledger, catalog, expenses, and website content.
- Arabic and English header aliases, including common patient, visit, result, finance, catalog, and CMS column names.
- A per-sheet type selector and a per-column mapping selector.
- Required/optional field metadata for each supported entity type.
- Duplicate target mapping prevention in automatic suggestions.
- Header-row changes and entity-type changes recalculate suggestions and preview.
- Unknown columns remain explicitly unmapped for owner review.

## Privacy and safety boundary

- The workbook is read in the current browser tab.
- The SHA-256 digest and preview metadata are shown; workbook rows are not uploaded.
- Mapping choices are held in the current page's memory only.
- No localStorage/sessionStorage persistence, Supabase access, Storage upload, import write, or schema change was added.
- The owner still must not treat suggestions as approved mappings.

## Test result

GitHub Actions run 44366695084 passed on commit 93f604772d5aa6466ff2c94842090254b1d4eecc: 132 tests passed, 0 failed. Synthetic fixtures cover multiple Arabic/English sheet types, blank rows, repeated header names, a late header row, unsupported extensions, empty files, the 20 MB boundary, and the 50-sheet boundary.

The first mapping test run exposed two issues: the Arabic hamza form in 'نتائج' was not normalized for sheet classification, and the CMS title field had no required marker. Both were corrected and the complete static suite passed.

## Not implemented

- Row-level duplicate detection and cross-sheet relationship checks.
- Per-row type/date/number validation and detailed error summaries.
- Matching legacy branch IDs to the existing SaaS branch UUIDs.
- Preserving age and age_type losslessly.
- Interpreting legacy financial_ledger type values or reconciling cumulative paid_amount.
- Creating historical workdays and converting visit IDs.
- Parsing result JSON into parameter-level rows while retaining the original payload.
- Deterministic source-to-target IDs, import checkpoints, retry safety, rollback, and dry-run reconciliation.
- Any actual patient, result, financial, catalog, attachment, or website content import.

The next safe step is to add synthetic row fixtures and row-level duplicate/validation analysis, still without importing data. Real import remains blocked until the unresolved schema and finance decisions in docs/legacy-data-migration-map.md are settled.