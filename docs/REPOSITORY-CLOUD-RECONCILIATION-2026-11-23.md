# Taiba Smart Lab — repository and cloud reconciliation (2026-11-23)

## Release baseline

- Repository: `teba-labs/teba-saas-demo`
- Baseline reviewed: `main` at `f91b90e7151e4dc88067d833444d52f00b3e5a9b`
- Primary Supabase project: `hgqwpykeazuzceeiumjg`
- Primary project URL: `https://hgqwpykeazuzceeiumjg.supabase.co`
- The legacy project `khjzoleiuiipyodpkieg` is not a target for this reconciliation.

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

The current main UI and shared serializer remain the source of truth; duplicate older UI and serializer files from PR #46 are intentionally not copied over them.

PR #42 is a draft containing an older 083 migration variant. It is superseded by the already-applied 083 plus the forward-only 084 approach. Keep its branch for history; do not apply its migration.

## Supabase migration inventory

The connected primary project reports 73 applied migrations, with `083_medical_master_catalog_model_v2` as the latest applied migration before this reconciliation.

The repository contains 84 migration files. The difference is not 11 pending production migrations:

- Migrations 023–075 are recorded in Supabase under their migration names without the repository's numeric filename prefix.
- Migrations 076–083 are recorded with their numeric names.
- Files 001–011 are the original bootstrap/baseline scripts; the live database already has the core tenant, branch, patient, visit, catalog, parameter, result, and workday schema. Do not replay these bootstrap files on the live database.
- `012_atomic_patient_portal_rate_limit.sql` is an older experimental/TEST restoration file whose own header says not to apply until the chain is reconciled. The active rate-limit migration is already recorded as `016_atomic_patient_portal_rate_limit`. Do not apply the old 012 file.

Migration 084 is the only new forward migration in this reconciliation. Apply it only to the confirmed primary project `hgqwpykeazuzceeiumjg`, after code checks pass. Never apply anything to the legacy project.

## Safety and verification

- No patient/test-result data is rewritten by migration 084; it replaces database functions and adds private validation helpers.
- Keep historical feature and backup branches; do not delete them as part of this reconciliation.
- Do not claim a live login/patient/result cycle is verified from static tests alone.
- After merge and migration, verify the new functions in the primary database, then verify the GitHub Pages deployment for the merged main SHA.
