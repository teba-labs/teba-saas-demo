# Legacy-to-SaaS data migration map (schema-only discovery)

Date: 2026-11-18
Scope: read-only metadata inspection of legacy Supabase `khjzoleiuiipyodpkieg` and SaaS TEST `hgqwpykeazuzceeiumjg`. No patient rows or result values were read. No database rows or schemas were changed.

## 1. Confirmed legacy source structure

Legacy public tables include:
- Clinical: `patients`, `visits`, `visit_tests`, `test_results`, `tests_catalog`.
- Legacy archive: `historical_results`, `historical_result_parameters`.
- Finance: `financial_ledger`, `expense_categories`.
- Tenant/operations: `tenants`, `branches`, `users`, `audit_logs`, `branch_print_settings`, `backup_runs`, `migration_runs`, `monthly_approvals`.
- Website: `site_settings`, `site_packages`, `site_articles`, `site_faqs`, `site_testimonials`, `offers`.

Important legacy key differences:
- Legacy branch IDs are integers; SaaS branch IDs are UUIDs.
- Legacy visit primary key is integer `visit_id`; SaaS visit primary key is UUID `id`.
- Legacy patient IDs are UUIDs, but the new patient table adds a required branch ID and uses `full_name` / `age_years` / `sex`.
- Legacy `visit_tests` stores `visit_id` + `test_code` + `price_at_time`; SaaS requires UUID `visit_id`, UUID `test_id`, and immutable code/name/price/technical snapshots.
- Legacy `test_results` stores one JSONB `results_data` object per visit test; SaaS stores one row per parameter with `parameter_code`, numeric/text values, unit snapshot, and reference-range snapshot.
- Legacy has no dedicated `payments` table. It stores cumulative `visits.paid_amount` and a generic `financial_ledger` with `type`, `item_name`, `amount`, `created_at`, and optional integer `visit_id`.
- Legacy patient age is `age` plus `age_type`; SaaS has only `age_years` numeric in the patient table. Exact preservation of original age unit needs an explicit representation decision before importing (do not silently discard age_type).
- Legacy `branch_print_settings` is per integer branch; SaaS `print_settings` supports tenant-wide or UUID branch-scoped JSON settings.

## 2. Current cloud row-count snapshot (counts only)

Legacy project aggregate counts at inspection time:
- patients: 4
- visits: 4
- visit_tests: 18
- test_results: 9
- historical_results: 0
- historical_result_parameters: 0
- financial_ledger: 10
- tests_catalog: 248
- site_packages/articles/FAQs/testimonials/offers: 0 each

These counts describe the legacy Supabase cloud only. They do **not** establish that all historical records are in the cloud: offline IndexedDB, local exports, other spreadsheets, and separate files have not been inspected. Do not use this small cloud count as proof that the complete archive has been found.

The existing Taiba SaaS TEST tenant had zero patients/visits at the previous read-only readiness check. No real data has been moved.

## 3. Proposed relational mapping (not yet implemented)

| Legacy source | SaaS target | Conversion / control |
|---|---|---|
| `branches.id/name/address` | existing `branches.id/name/address` | Match by confirmed branch identity/name; keep an explicit old integer -> existing SaaS UUID map. Never create duplicate Taiba branches. |
| `patients.id/name/phone/age/age_type/gender` | `patients` | Preserve source patient UUID as external source key in staging/import manifest; match duplicates by normalized name + phone + age/sex as suggestions only. Resolve age unit before final import. |
| `visits.visit_id/patient_id/branch_id/visit_date/status` | `visits` | Map patient and branch first; generate stable UUID per source visit; map visit date to historical work date and create closed historical `branch_workdays` where needed because SaaS visits require `workday_id`. |
| `visit_tests.visit_id/test_code/price_at_time/is_cancelled` | `visit_tests` | Match catalog by exact code first, then reviewed normalized name; preserve source price in `price_snapshot`; do not replace historical price with current catalog price. Unmatched tests go to a review queue. |
| `test_results.results_data` | `test_results` | Parse the JSON shape into one row per parameter; preserve raw original JSON in an import archive until all values, units, ranges, text results, and special values are reconciled. |
| `visits.total_amount/discount/paid_amount` | `visit_billing` + `payments` | Billing snapshot must reconcile to test prices and discounts. Cumulative paid amount alone is not payment history. Use actual dated ledger inflows when they can be reliably linked; otherwise preserve an explicitly labeled opening/legacy balance rather than inventing payment dates or methods. |
| `financial_ledger` | `payments` / `expenses` / migration reconciliation archive | Determine exact legacy `type` values and linkage first. Preserve original timestamp and branch. Do not convert ambiguous movements into payments/expenses automatically. |
| `tests_catalog` + JSON `parameters` | `tests_catalog` + `test_parameters` + `test_prices` | Separate technical parameters from prices; review all codes and ranges. Historical visit snapshots must remain unchanged if current catalog is later edited. |
| `branch_print_settings` + `site_settings` | `print_settings` + `lab_settings` + `site_settings` | Separate internal report layout from public website branding/content; translate old branch IDs to new UUIDs. |
| `site_packages/articles/faqs/testimonials/offers` | SaaS CMS tables | Field-by-field mapping; import as unpublished draft content pending owner review. |
| old files and PDFs | `file_metadata` + tenant-scoped Storage buckets / report versions | Copy only after inventory, hash/checksum, visit matching, and destination privacy classification. Never reuse old public URLs as SaaS private file paths. |

## 4. Blocking questions the importer must resolve from sanitized samples

1. Exact JSON shape and key variants of legacy `test_results.results_data`.
2. Exact values and semantics of `financial_ledger.type`, and which entries represent payments, refunds, expenses, or other movements.
3. Whether every legacy visit has a trustworthy visit number; the legacy table currently exposes `visit_id` as its primary key but no separate visit-number column.
4. Whether old patient age units can be converted to years without loss, or require a schema addition / preserved source metadata.
5. How old report PDFs and attachments are named and whether a reliable visit identifier exists in their metadata.
6. Whether the offline IndexedDB database or separate Excel exports contain records beyond the small legacy cloud snapshot.

## 5. Import safety contract

- First import is a dry run over sanitized/synthetic data; no real patient identifiers in TEST until the owner explicitly approves the dataset and destination.
- Read every workbook sheet; record file hash, sheet name, row number, source identifiers, and mapping version.
- Generate deterministic import keys from source project/table/primary key; retry must not duplicate rows.
- Preview per sheet: recognized columns, unresolved columns, row totals, duplicates, invalid rows, orphan relations, branch mapping, date range, and financial reconciliation.
- Never auto-merge patients. Similarity is a review suggestion only.
- Import dependency order: branches/catalog map -> patients -> historical workdays -> visits -> visit tests -> results -> billing/payments -> attachments/reports -> website content/settings.
- Batch writes need checkpoints and per-row outcomes. A failed batch must resume from its checkpoint without replaying successful rows.
- Keep a source-to-target ID map for every entity. Preserve original values and a reversible import batch reference.
- Reconcile counts and financial totals before activation. Do not publish historical reports or website content automatically.
- Rollback must remove only rows owned by that import batch, in reverse dependency order, and must not remove records edited or referenced after import without an explicit recovery plan.

## 6. Not done

- No patient-level source data or result values were queried.
- No real patient data, financial rows, catalog rows, or content were copied.
- No schema changes, storage changes, or migration execution.
- This document is a verified schema map and design contract, not a completed importer.
