# Batch 21 — Catalog-to-results value-type integration

Date: 18 November 2026

## Findings
- The catalog snapshot already stored `value_type` and `choices` per visit test, but the results workbench rendered every parameter as a plain text input.
- The existing database result trigger distinguished numeric from non-numeric values, but did not enforce boolean literals or membership in the frozen choice list.
- This allowed a staff client to submit a text value outside a catalog-defined choice list through a direct API request, even though the intended catalog contract was narrower.

## Implemented
- Results workbench now renders numeric inputs with snapshot decimal precision, text inputs, boolean selectors (`true`/`false`, displayed as نعم/لا), and choice selectors populated from the visit's frozen `choices` array.
- Existing result loading no longer overwrites the snapshot's `value_type` in the control metadata.
- Client repository validates boolean and choice values before sending writes.
- Catalog repository requires choice values to be non-empty unique text entries.
- Added migration `009_result_value_type_validation.sql` to strengthen the existing server-side trigger. It validates finite numeric results, canonical boolean values, and exact choice membership against the immutable visit snapshot. It continues to copy parameter name, unit and reference range from that snapshot rather than trusting browser-supplied report metadata.
- Added static regression tests for all four value types and migration contract.

## Validation
- `node --test tests/static/*.test.mjs`: 90 passed, 0 failed.
- JavaScript syntax checks: 34/34 files passed. Original-source manifest: 31/31 SHA-256 hashes match.

## Boundaries
- Migration 009 is a prepared source artifact only; it has NOT been executed on TEST or production.
- No live Supabase, RLS, direct-API, correction-workflow or browser runtime test was performed.
- No deployment occurred.

## Important behavior contract
- Boolean values stored are exactly `true` or `false`; the UI labels them نعم / لا.
- Choice values stored must exactly match one string in the visit's frozen `choices` array.
- Editing the catalog later does not alter prior visits because results are validated against `visit_tests.technical_snapshot`.
