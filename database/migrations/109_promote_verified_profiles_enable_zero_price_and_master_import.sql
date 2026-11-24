-- Taiba Smart Lab: promote verified profiles into the published core library,
-- enable zero-price operation, and remove the post-import local activation gate.
-- This migration reads the existing verified Taiba profile definitions; it does not
-- modify patient, visit, result, or historical report records.

DO $$
DECLARE
  v_source_tenants integer;
BEGIN
  SELECT count(*) INTO v_source_tenants
  FROM (
    SELECT tenant_id
    FROM public.tests_catalog
    WHERE code IN (
      'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
      'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
    )
      AND clinical_review_status = 'verified'
    GROUP BY tenant_id
    HAVING count(DISTINCT code) = 9
  ) source_tenants;

  IF v_source_tenants <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one tenant with all nine verified Taiba source profiles; found %.',
      v_source_tenants;
  END IF;
END;
$$;

CREATE TEMP TABLE _taiba_source_profiles ON COMMIT DROP AS
SELECT
  tc.tenant_id,
  tc.id AS source_test_id,
  tc.code AS source_code,
  tc.code AS target_code,
  CASE tc.code
    WHEN 'HEM_CBC' THEN 'CBC'
    WHEN 'UA_COMPLETE' THEN 'URN'
    WHEN 'STOOL_EXAM' THEN 'STOOL'
    WHEN 'IRON_PROFILE' THEN 'IRON'
    WHEN 'LIPID_PROFILE' THEN 'LIPID'
    WHEN 'LIVER_PROFILE' THEN 'LFT'
    ELSE NULL
  END AS legacy_master_code
FROM public.tests_catalog tc
WHERE tc.tenant_id = (
  SELECT tenant_id
  FROM public.tests_catalog
  WHERE code IN (
    'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
    'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
  )
    AND clinical_review_status = 'verified'
  GROUP BY tenant_id
  HAVING count(DISTINCT code) = 9
)
AND tc.code IN (
  'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
  'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM _taiba_source_profiles) <> 9 THEN
    RAISE EXCEPTION 'The nine verified source profiles could not be resolved.';
  END IF;
END;
$$;

-- Add a multi-select crystal classifier without changing the historical free-text
-- UA_CRYSTALS parameter or any existing visit result snapshot.
INSERT INTO public.test_parameters (
  tenant_id, test_id, parameter_code, parameter_name, value_type,
  result_input_mode, result_config, decimal_places, reference_ranges,
  choices, display_rules, display_order, is_required, result_source,
  source_references, clinical_review_status, clinical_metadata,
  reference_interval_status, is_active
)
SELECT
  sp.tenant_id,
  sp.source_test_id,
  'UA_CRYSTAL_TYPES',
  'Urine crystal types (pH-guided suggestions)',
  'choice',
  'multi_choice',
  '{}'::jsonb,
  0,
  '[]'::jsonb,
  '[
    "Not seen",
    "Calcium oxalate",
    "Uric acid",
    "Amorphous urates",
    "Cystine",
    "Calcium phosphate",
    "Amorphous phosphates",
    "Triple phosphate (struvite)",
    "Ammonium biurate",
    "Other / specify"
  ]'::jsonb,
  '[
    {
      "when":{"parameter_code":"UA_PH","operator":"lt","value":"6.5"},
      "visible_values":["Not seen","Calcium oxalate","Uric acid","Amorphous urates","Cystine","Other / specify"]
    },
    {
      "when":{"parameter_code":"UA_PH","operator":"gte","value":"6.5"},
      "visible_values":["Not seen","Calcium oxalate","Calcium phosphate","Amorphous phosphates","Triple phosphate (struvite)","Ammonium biurate","Other / specify"]
    }
  ]'::jsonb,
  38,
  false,
  'manual',
  '[{"title":"Urinalysis - Clinical Methods, Chapter 191","organization":"NCBI Bookshelf / National Library of Medicine","url":"https://www.ncbi.nlm.nih.gov/books/NBK302/"}]'::jsonb,
  'needs_review',
  '{"pH_guidance":"Common associations only; urine pH does not absolutely exclude a crystal type. Confirm morphology microscopically and retain the free-text UA_CRYSTALS field for unusual findings."}'::jsonb,
  'not_applicable',
  true
FROM _taiba_source_profiles sp
WHERE sp.source_code = 'UA_COMPLETE'
ON CONFLICT (tenant_id, test_id, parameter_code) DO NOTHING;

-- Create the first actual published release. The current master rows had no release,
-- which left the central library invisible to the import UI.
INSERT INTO public.master_catalog_releases (
  version, title, description, status, published_at
)
SELECT
  'taiba-core-2026.11.24-r1',
  'Taiba Core Catalog — 24 Nov 2026',
  'Published core catalog with nine source-backed profiles promoted from verified Taiba definitions. Import is not blocked by local clinical-review metadata.',
  'published',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_catalog_releases
  WHERE version = 'taiba-core-2026.11.24-r1'
);

UPDATE public.master_catalog_releases
SET
  title = 'Taiba Core Catalog — 24 Nov 2026',
  description = 'Published core catalog with nine source-backed profiles promoted from verified Taiba definitions. Import is not blocked by local clinical-review metadata.',
  status = 'published',
  published_at = coalesce(published_at, now())
WHERE version = 'taiba-core-2026.11.24-r1';

CREATE TEMP TABLE _taiba_release ON COMMIT DROP AS
SELECT id, version
FROM public.master_catalog_releases
WHERE version = 'taiba-core-2026.11.24-r1'
ORDER BY published_at DESC NULLS LAST
LIMIT 1;

-- Preserve the previous six master definitions before promoting their richer
-- verified counterparts. The old Friedewald LDL expression is retained only in
-- legacy_snapshot; it is deliberately not re-enabled as a default LDL result.
UPDATE public.master_catalog_tests m
SET legacy_snapshot =
  coalesce(m.legacy_snapshot, '{}'::jsonb) ||
  jsonb_build_object('pre_2026_11_24', to_jsonb(m))
WHERE m.master_code IN ('CBC','URN','STOOL','IRON','LIPID','LFT');

UPDATE public.master_catalog_parameters p
SET legacy_snapshot =
  coalesce(p.legacy_snapshot, '{}'::jsonb) ||
  jsonb_build_object('pre_2026_11_24', to_jsonb(p))
WHERE p.master_test_id IN (
  SELECT id FROM public.master_catalog_tests
  WHERE master_code IN ('CBC','URN','STOOL','IRON','LIPID','LFT')
);

-- Rename the six legacy master codes to the verified canonical profile codes,
-- and refresh their technical definitions from the source tenant.
UPDATE public.master_catalog_tests m
SET
  master_code = sp.target_code,
  canonical_name = tc.name,
  alternate_names = to_jsonb(tc.synonyms),
  test_kind = tc.test_kind,
  category = tc.category,
  service_type = tc.service_type,
  definition = jsonb_strip_nulls(jsonb_build_object(
    'specimen', tc.specimen,
    'method', tc.method,
    'turnaround_minutes', tc.turnaround_minutes,
    'instructions', tc.instructions,
    'short_name', tc.short_name,
    'loinc_code', tc.loinc_code,
    'clinical_category', tc.clinical_category,
    'clinical_purpose', tc.clinical_purpose,
    'patient_preparation', tc.patient_preparation,
    'collection_requirements', tc.collection_requirements,
    'specimen_requirements', tc.specimen_requirements,
    'transport_requirements', tc.transport_requirements,
    'stability_requirements', tc.stability_requirements,
    'rejection_criteria', tc.rejection_criteria,
    'biosafety_notes', tc.biosafety_notes,
    'critical_result_policy', tc.critical_result_policy,
    'reporting_notes', tc.reporting_notes,
    'source_references', tc.source_references,
    'components', tc.components
  )),
  clinical_review_status = tc.clinical_review_status,
  source_name = 'Taiba Labs verified profile',
  release_id = (SELECT id FROM _taiba_release),
  updated_at = now()
FROM _taiba_source_profiles sp
JOIN public.tests_catalog tc
  ON tc.tenant_id = sp.tenant_id AND tc.id = sp.source_test_id
WHERE m.master_code = sp.legacy_master_code
  AND sp.legacy_master_code IS NOT NULL;

-- Add the three formula-bearing profiles that did not previously exist in master.
INSERT INTO public.master_catalog_tests (
  release_id, master_code, canonical_name, alternate_names, test_kind,
  category, service_type, definition, clinical_review_status, source_name
)
SELECT
  r.id,
  sp.target_code,
  tc.name,
  to_jsonb(tc.synonyms),
  tc.test_kind,
  tc.category,
  tc.service_type,
  jsonb_strip_nulls(jsonb_build_object(
    'specimen', tc.specimen,
    'method', tc.method,
    'turnaround_minutes', tc.turnaround_minutes,
    'instructions', tc.instructions,
    'short_name', tc.short_name,
    'loinc_code', tc.loinc_code,
    'clinical_category', tc.clinical_category,
    'clinical_purpose', tc.clinical_purpose,
    'patient_preparation', tc.patient_preparation,
    'collection_requirements', tc.collection_requirements,
    'specimen_requirements', tc.specimen_requirements,
    'transport_requirements', tc.transport_requirements,
    'stability_requirements', tc.stability_requirements,
    'rejection_criteria', tc.rejection_criteria,
    'biosafety_notes', tc.biosafety_notes,
    'critical_result_policy', tc.critical_result_policy,
    'reporting_notes', tc.reporting_notes,
    'source_references', tc.source_references,
    'components', tc.components
  )),
  tc.clinical_review_status,
  'Taiba Labs verified profile'
FROM _taiba_source_profiles sp
JOIN public.tests_catalog tc
  ON tc.tenant_id = sp.tenant_id AND tc.id = sp.source_test_id
CROSS JOIN _taiba_release r
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_catalog_tests existing
  WHERE existing.master_code = sp.target_code
);

-- Ensure every existing master definition belongs to the published release.
UPDATE public.master_catalog_tests
SET release_id = (SELECT id FROM _taiba_release),
    updated_at = now();

-- Replace only the parameter definitions for the nine promoted profiles.
-- Other master analyses are left intact.
DELETE FROM public.master_catalog_parameters
WHERE master_test_id IN (
  SELECT id FROM public.master_catalog_tests
  WHERE master_code IN (
    'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
    'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
  )
);

INSERT INTO public.master_catalog_parameters (
  master_test_id, parameter_code, parameter_name, unit, unit_ucum,
  value_type, decimal_places, reference_ranges, critical_ranges, choices,
  applicability, interpretation_rules, display_order, is_required,
  result_source, formula, clinical_metadata, source_references,
  clinical_review_status, alternate_units, reference_interval_status,
  result_input_mode, result_config, display_rules, formula_expression
)
SELECT
  m.id,
  tp.parameter_code,
  tp.parameter_name,
  tp.unit,
  tp.unit_ucum,
  tp.value_type,
  tp.decimal_places,
  tp.reference_ranges,
  tp.critical_ranges,
  tp.choices,
  tp.applicability,
  tp.interpretation_rules,
  tp.display_order,
  tp.is_required,
  tp.result_source,
  tp.formula::text,
  coalesce(tp.clinical_metadata, '{}'::jsonb) ||
    CASE WHEN nullif(btrim(tp.method_notes), '') IS NOT NULL
      THEN jsonb_build_object('method_notes', tp.method_notes)
      ELSE '{}'::jsonb
    END,
  tp.source_references,
  tp.clinical_review_status,
  tp.alternate_units,
  tp.reference_interval_status,
  tp.result_input_mode,
  tp.result_config,
  tp.display_rules,
  tp.formula_expression
FROM _taiba_source_profiles sp
JOIN public.test_parameters tp
  ON tp.tenant_id = sp.tenant_id AND tp.test_id = sp.source_test_id
JOIN public.master_catalog_tests m
  ON m.master_code = sp.target_code;

-- Repair missing result-input modes in the remaining master definitions.
-- A choice field with no configured choices becomes free text, never an empty
-- dropdown. No reference range or unit is invented for unrelated tests.
UPDATE public.master_catalog_parameters
SET value_type = 'text',
    result_input_mode = 'text'
WHERE value_type = 'choice'
  AND (choices IS NULL OR jsonb_array_length(choices) = 0)
  AND coalesce(result_source, 'manual') = 'manual';

UPDATE public.master_catalog_parameters
SET result_input_mode = CASE
  WHEN result_source = 'calculated' THEN 'numeric_decimal'
  WHEN value_type = 'numeric' AND coalesce(decimal_places, 2) = 0 THEN 'numeric_integer'
  WHEN value_type = 'numeric' THEN 'numeric_decimal'
  WHEN value_type = 'boolean' THEN 'boolean'
  WHEN value_type = 'choice' AND jsonb_array_length(coalesce(choices, '[]'::jsonb)) > 0 THEN 'single_choice'
  ELSE 'text'
END
WHERE result_input_mode IS NULL OR btrim(result_input_mode) = '';

UPDATE public.master_catalog_parameters
SET result_config = '{}'::jsonb
WHERE result_config IS NULL;

UPDATE public.master_catalog_parameters
SET display_rules = '[]'::jsonb
WHERE display_rules IS NULL;

-- Link the existing verified source profiles to their new master definitions.
-- The tenant's clinical results, visits, prices, and parameter rows are not
-- replaced; the baseline snapshot records the exact source state.
INSERT INTO public.tenant_catalog_master_links (
  tenant_id, test_id, master_test_id, imported_release_id,
  last_applied_version, baseline_snapshot, customization_fields, sync_status
)
SELECT
  sp.tenant_id,
  sp.source_test_id,
  m.id,
  r.id,
  r.version,
  jsonb_build_object(
    'test', to_jsonb(tc),
    'parameters', coalesce((
      SELECT jsonb_agg(to_jsonb(tp) ORDER BY tp.display_order, tp.parameter_code)
      FROM public.test_parameters tp
      WHERE tp.tenant_id = sp.tenant_id AND tp.test_id = sp.source_test_id
    ), '[]'::jsonb)
  ),
  ARRAY[]::text[],
  'current'
FROM _taiba_source_profiles sp
JOIN public.tests_catalog tc
  ON tc.tenant_id = sp.tenant_id AND tc.id = sp.source_test_id
JOIN public.master_catalog_tests m
  ON m.master_code = sp.target_code
CROSS JOIN _taiba_release r
ON CONFLICT (tenant_id, test_id) DO NOTHING;

-- A missing price means zero, not a blocked test. Seed a zero base price for
-- every existing test without one; branch-specific prices continue to override it.
INSERT INTO public.test_prices (
  tenant_id, test_id, branch_id, selling_price, is_current
)
SELECT
  tc.tenant_id, tc.id, NULL, 0, true
FROM public.tests_catalog tc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.test_prices p
  WHERE p.tenant_id = tc.tenant_id
    AND p.test_id = tc.id
    AND p.is_current = true
    AND p.branch_id IS NULL
)
ON CONFLICT (tenant_id, test_id)
  WHERE (is_current = true AND branch_id IS NULL)
DO NOTHING;

CREATE OR REPLACE FUNCTION private.ensure_zero_base_price_for_new_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  INSERT INTO public.test_prices (
    tenant_id, test_id, branch_id, selling_price, is_current
  )
  VALUES (NEW.tenant_id, NEW.id, NULL, 0, true)
  ON CONFLICT (tenant_id, test_id)
    WHERE (is_current = true AND branch_id IS NULL)
  DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ensure_zero_base_price_for_new_test ON public.tests_catalog;
CREATE TRIGGER ensure_zero_base_price_for_new_test
AFTER INSERT ON public.tests_catalog
FOR EACH ROW
EXECUTE FUNCTION private.ensure_zero_base_price_for_new_test();

-- Import now returns the active independent tenant copy. It no longer flips
-- is_active to false and no longer requires a second local activation step.
CREATE OR REPLACE FUNCTION public.import_master_catalog_test(
  p_tenant_id uuid,
  p_master_test_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_test_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT private.is_tenant_owner(p_tenant_id) THEN
    RAISE EXCEPTION 'Only the tenant owner can import a master catalog test.';
  END IF;

  v_test_id := public.import_master_catalog_test_unchecked(
    p_tenant_id,
    p_master_test_id
  );

  RETURN v_test_id;
END;
$function$;

DO $$
DECLARE
  v_release_id uuid := (SELECT id FROM _taiba_release);
  v_missing_modes integer;
  v_bad_formulas integer;
  v_bad_dependencies integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.master_catalog_releases
    WHERE id = v_release_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'The Taiba core catalog release was not published.';
  END IF;

  IF (
    SELECT count(*) FROM public.master_catalog_tests
    WHERE release_id = v_release_id
  ) < 179 THEN
    RAISE EXCEPTION 'Expected the published release to contain the existing catalog plus promoted profiles.';
  END IF;

  SELECT count(*) INTO v_missing_modes
  FROM public.master_catalog_parameters
  WHERE result_input_mode IS NULL OR btrim(result_input_mode) = '';

  IF v_missing_modes > 0 THEN
    RAISE EXCEPTION 'There are still % master parameters without an input mode.', v_missing_modes;
  END IF;

  SELECT count(*) INTO v_bad_formulas
  FROM public.master_catalog_parameters
  WHERE result_source = 'calculated'
    AND (
      formula IS NULL
      OR jsonb_typeof(formula::jsonb) <> 'object'
    );

  IF v_bad_formulas > 0 THEN
    RAISE EXCEPTION 'There are still % calculated master parameters without a valid formula AST.', v_bad_formulas;
  END IF;

  WITH formulas AS (
    SELECT master_test_id, parameter_code, formula::jsonb AS ast
    FROM public.master_catalog_parameters
    WHERE result_source = 'calculated'
  ),
  dependencies AS (
    SELECT
      f.master_test_id,
      f.parameter_code,
      dependency.value #>> '{}' AS dependency_code
    FROM formulas f
    CROSS JOIN LATERAL jsonb_path_query(f.ast, '$.**.param') AS dependency(value)
  )
  SELECT count(*) INTO v_bad_dependencies
  FROM dependencies d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.master_catalog_parameters p
    WHERE p.master_test_id = d.master_test_id
      AND p.parameter_code = d.dependency_code
  );

  IF v_bad_dependencies > 0 THEN
    RAISE EXCEPTION 'There are % formula dependencies missing from their profile.', v_bad_dependencies;
  END IF;
END;
$$;
