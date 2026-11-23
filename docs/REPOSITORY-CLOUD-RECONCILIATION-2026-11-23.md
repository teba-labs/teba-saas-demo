# Taiba Smart Lab — repository and cloud reconciliation (2026-11-23)

## Release baseline

- Repository: `teba-labs/teba-saas-demo`
- Baseline reviewed: `main` at `f91b90e7151e4dc88067d833444d52f00b3e5a9b`
- Primary Supabase project: `hgqwpykeazuzceeiumjg`
- Primary project URL: `https://hgqwpykeazuzceeiumjg.supabase.co`
- The legacy project `khjzoleiuiipyodpkieg` is not a target for this reconciliation.
- The connected Supabase branch inventory exposed only `main`; it did not expose a branch named `TEST`. This is a limitation of the connected view, not proof that no TEST branch exists in the dashboard. No changes were made to an unverified branch.

## Current main features already integrated

The following recent release PRs are already merged into `main`:

- #38 — responsive workspace and dedicated results entry
- #39 — one-cycle product redesign
- #40 — timeless accountant price-sheet imports
- #41 — dashboard historical intelligence and responsive layout
- #43 — browser zoom and responsive application layout
- #44 — medical catalog v2 and doctor-friendly result entry
- #45 — semantic/accessibility labels for medical result fields

The older owner-dashboard, print-settings, catalog-foundation, reception, and workbench branches are historical development lines. Their work was subsequently carried into the merged release PRs above and earlier merged release PRs. GitHub ahead/behind counts on those old branches are ancestry counts; they are not a reliable measure of missing source changes after squash merges.

## Medical result-input reconciliation

PR #46 was not merged directly because its branch was based on an earlier version of the catalog/results UI and contained a second copy of migration 083. Replacing current main files with that branch would have regressed existing behavior and failed regression tests.

The useful database-side changes from that work are carried forward in migration:

- `084_medical_result_input_validation_and_conditional_rules.sql`
- Adds/replaces server-side validators for all configured result input modes.
- Enforces configured choice lists and maximum selections.
- Validates conditional choice visibility using the current main UI's `when / visible_values` representation, while retaining compatibility with the earlier `source_parameter_code / choices` representation.
- Updates the catalog import/snapshot and atomic draft-save/completion/approval functions.
- Does not recreate tables or replay migration 083.

A second forward-only migration, `085_clear_disallowed_conditional_result_values.sql`, is included in the documentation follow-up PR. It updates save/completion/approval functions so an old selected value is cleared if a changed controller makes that choice unavailable, and it mirrors the UI's multi-choice controller semantics. It does not bulk-delete existing records at migration time; cleanup occurs only through the normal result save/completion/approval flow. It must pass CI before being applied.

The current main UI and shared serializer remain the source of truth; duplicate older UI and serializer files from PR #46 are intentionally not copied over them.

PR #42 is a draft containing an older 083 migration variant. It is superseded by the already-applied 083 plus the forward-only 084 approach. Keep its branch for history; do not apply its migration.

## Supabase migration inventory

Before this reconciliation, the connected primary project reported 73 applied migrations, with `083_medical_master_catalog_model_v2` as the latest. After applying migration 084, the project reports **74 applied migrations**, with `084_medical_result_input_validation_and_conditional_rules` as the latest.

The repository contains 86 migration files. A normalized name comparison shows 74 applied migration records, 12 repository-only names, and one applied-only name; this is not a list of 11 pending production migrations:

- Migrations 023–075 are recorded in Supabase under their migration names without the repository's numeric filename prefix.
- Migrations 076–083 are recorded with their numeric names.
- Files 001–011 are the original bootstrap/baseline scripts; the live database already has the core tenant, branch, patient, visit, catalog, parameter, result, and workday schema. Do not replay these bootstrap files on the live database.
- `012_atomic_patient_portal_rate_limit.sql` is an older experimental/TEST restoration file whose own header says not to apply until the chain is reconciled. The active rate-limit migration is already recorded as `016_atomic_patient_portal_rate_limit`. Do not apply the old 012 file.
- Supabase also records an applied migration named `allow_preapproval_range_corrections` (version `20261120223445`) for which there is no matching SQL file in current `main`. The final `set_visit_parameter_range_override` implementation is represented by migration 061, including pre-approval and published-correction rules. Do not invent or replay a replacement for the missing historical SQL; recover its exact source from a backup/TEST archive if byte-for-byte migration history is required.

Migration 084 was applied successfully to the confirmed primary project `hgqwpykeazuzceeiumjg`. Migration 085 is still pending final CI/merge and must be applied to the same project only after those checks pass. No migration was applied to the legacy project.

## Safety and verification

- Migration 084 only replaces database functions and adds private validation helpers; it does not run a bulk data update.
- Migration 085 changes future save/completion/approval behavior to clear a previously stored choice only when the controller now makes that choice invalid; it does not run that cleanup as a bulk migration operation.
- Keep historical feature and backup branches; do not delete them as part of this reconciliation.
- Do not claim a live login/patient/result cycle is verified from static tests alone.
- Verified the new validator, conditional-choice, draft-save, completion, and approval functions exist in the primary database.
- Read-only behavior probes passed for integer validation, comparator values, maximum-choice enforcement, graded-choice validation, and conditional visible-choice allow/reject behavior.
- Static/unit CI passed: 320 tests, 0 failures. Responsive browser zoom QA passed.
- GitHub Pages build and deployment succeeded for main commit `2313e947bf027c86a2699dfe40da26e8981b155c`.
- Preview URL: `https://teba-labs.github.io/teba-saas-demo/`. The deployment action succeeded, but the web inspection tool could not open the live URL; a full interactive login-to-result-entry cycle is therefore not claimed as manually verified.
