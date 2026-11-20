-- Mark profile fields optional when not universally produced or only present in abnormal findings.
update public.master_catalog_parameters p
set is_required = case
 when t.master_code='HEM_CBC' and p.parameter_code in ('RDW_SD','MPV','PDW','PCT','NRBC_PCT','RBC_MORPH','WBC_MORPH','PLT_MORPH','SMEAR_COMMENT') then false
 when t.master_code='UA_COMPLETE' and p.parameter_code in ('UA_RENAL_EPITHELIAL','UA_HYALINE_CASTS','UA_GRANULAR_CASTS','UA_WBC_CASTS','UA_RBC_CASTS','UA_WAXY_CASTS','UA_CRYSTALS','UA_BACTERIA','UA_YEAST','UA_MUCUS','UA_TRICHOMONAS','UA_SPERM','UA_SEDIMENT_COMMENT') then false
 when t.master_code='STOOL_EXAM' and p.parameter_code in ('ST_ADULT_WORMS','ST_FAT','ST_STARCH','ST_MUSCLE','ST_YEAST','ST_CHARCOT','ST_MACROPHAGES','ST_COMMENT') then false
 when t.master_code='CULTURE_URINE' and p.parameter_code in ('CU_COLONY_COUNT','CU_IDENTIFICATION','CU_AST_COMMENT') then false
 when t.master_code='CULTURE_STOOL' and p.parameter_code in ('CS_PATHOGEN','CS_AST_COMMENT') then false
 else true end
from public.master_catalog_tests t
where p.master_test_id=t.id
 and t.release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1');

