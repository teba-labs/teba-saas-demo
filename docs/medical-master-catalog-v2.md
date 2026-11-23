# Medical master catalog v2

This change reshapes the existing `master_catalog_tests` and `master_catalog_parameters` rows. It does not create a new master catalog, range, parameter, or group table.

## Data safety

Before normalizing any existing master record, the migration stores the complete original row in its `legacy_snapshot` JSONB column. The original master data set remains 540 tests and 846 parameter rows. Legacy formula ASTs remain in `formula`; readable expressions are populated in `formula_expression`.

The four legacy text-only stool microscopy reference objects are converted to one-item arrays, with their exact original object retained in `legacy_snapshot`. Existing numeric reference interval objects are likewise retained and age entries receive explicit `min_unit` and `max_unit` values while preserving the original `unit`.

## Doctor-facing result model

`result_input_mode` distinguishes integer and decimal numeric inputs, comparator numeric inputs, free text, positive/negative, boolean, single choice, multiple choice, and graded multiple choice. The old `value_type` field is retained for runtime compatibility.

`result_config` stores choice definitions and grading settings. `display_rules` stores same-test conditional visibility rules. For example, a pH parameter may control which crystal options appear; the migration does not seed or invent a crystal list.

## Test composition

`test_kind` now supports `individual`, `panel`, and `group`. Group components are stored in the existing `master_catalog_tests.definition.components` array as ordered references to existing master codes. Imported tenant test rows keep those references in the existing `tests_catalog.components` column and visit technical snapshots.

## Deliberately retained

Clinical metadata, source references, critical ranges, interpretation rules, alternate units, and the existing JSON formula AST are not deleted. The doctor-facing editor can hide advanced fields without discarding their content.
