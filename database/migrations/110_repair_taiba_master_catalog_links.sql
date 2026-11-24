-- Repair the nine pre-existing Taiba links that still referenced retired master IDs.
-- Only link metadata is changed; tenant catalog rows and results remain untouched.
UPDATE public.tenant_catalog_master_links l
SET
  master_test_id = mt.id,
  imported_release_id = r.id,
  last_applied_version = r.version,
  baseline_snapshot = jsonb_build_object(
    'test', to_jsonb(tc),
    'parameters', coalesce((
      SELECT jsonb_agg(to_jsonb(tp) ORDER BY tp.display_order, tp.parameter_code)
      FROM public.test_parameters tp
      WHERE tp.tenant_id = tc.tenant_id AND tp.test_id = tc.id
    ), '[]'::jsonb)
  ),
  sync_status = 'current'
FROM public.tests_catalog tc
JOIN public.master_catalog_tests mt
  ON mt.master_code = tc.code
JOIN public.master_catalog_releases r
  ON r.id = mt.release_id AND r.version = 'taiba-core-2026.11.24-r1'
WHERE l.tenant_id = tc.tenant_id
  AND l.test_id = tc.id
  AND tc.code IN (
    'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
    'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
  );

DO $$
DECLARE
  v_linked integer;
BEGIN
  SELECT count(*) INTO v_linked
  FROM public.tenant_catalog_master_links l
  JOIN public.tests_catalog tc
    ON tc.tenant_id = l.tenant_id AND tc.id = l.test_id
  JOIN public.master_catalog_tests mt
    ON mt.id = l.master_test_id AND mt.master_code = tc.code
  WHERE tc.code IN (
    'HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE',
    'LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'
  );

  IF v_linked <> 9 THEN
    RAISE EXCEPTION 'Expected nine repaired source-profile links; found %.', v_linked;
  END IF;
END;
$$;