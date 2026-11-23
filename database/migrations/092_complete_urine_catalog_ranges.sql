-- 092: Complete urine examination and culture decision-context fields.
begin;

update public.master_catalog_parameters p
   set unit=case p.parameter_code when 'UA_SPECIFIC_GRAVITY' then 'unitless' when 'UA_PH' then 'pH' else p.unit end,
       reference_ranges=case p.parameter_code
         when 'UA_SPECIFIC_GRAVITY' then jsonb_build_array(jsonb_build_object('lower',1.002,'upper',1.030,'unit','unitless','source','Mayo Clinic Laboratories Specific Gravity, Random Urine (606565)','population','Random urine; refractometry method-dependent'))
         when 'UA_PH' then jsonb_build_array(jsonb_build_object('lower',4.5,'upper',8.0,'unit','pH','source','Mayo Clinic Laboratories pH, Random Urine (606510)','population','Random urine; diet and clinical state affect pH'))
         when 'UA_RBC_HPF' then jsonb_build_array(jsonb_build_object('lower',0,'upper',2,'unit','/HPF','source','University of Iowa Urinalysis Microscopy','population','Urine sediment; flow-through microscopy'))
         when 'UA_WBC_HPF' then jsonb_build_array(jsonb_build_object('lower',0,'upper',5,'unit','/HPF','source','University of Iowa Urinalysis Microscopy','population','Urine sediment; flow-through microscopy'))
         when 'UA_SQUAMOUS' then jsonb_build_array(jsonb_build_object('lower',0,'upper',2,'unit','/HPF','source','University of Iowa Urinalysis Microscopy','population','Urine sediment; method-specific'))
         when 'UA_TRANSITIONAL' then jsonb_build_array(jsonb_build_object('lower',0,'upper',2,'unit','/LPF','source','Hunterdon Medical Center Urinalysis','population','Urine sediment; method-specific'))
         when 'UA_RENAL_EPITHELIAL' then jsonb_build_array(jsonb_build_object('lower',0,'upper',2,'unit','/LPF','source','Hunterdon Medical Center Urinalysis','population','Urine sediment; method-specific'))
         when 'UA_HYALINE_CASTS' then jsonb_build_array(jsonb_build_object('lower',0,'upper',2,'unit','/LPF','source','University of Iowa Urinalysis Microscopy','population','Urine sediment; method-specific'))
         when 'UA_GRANULAR_CASTS' then jsonb_build_array(jsonb_build_object('text','None seen','source','Alberta Health Services Urinalysis reference table','population','Urine sediment; other cast types absent in normal specimen'))
         when 'UA_WBC_CASTS' then jsonb_build_array(jsonb_build_object('text','None seen','source','Alberta Health Services Urinalysis reference table','population','Urine sediment'))
         when 'UA_RBC_CASTS' then jsonb_build_array(jsonb_build_object('text','None seen','source','Alberta Health Services Urinalysis reference table','population','Urine sediment'))
         when 'UA_WAXY_CASTS' then jsonb_build_array(jsonb_build_object('text','None seen','source','Alberta Health Services Urinalysis reference table','population','Urine sediment'))
         else p.reference_ranges
       end,
       reference_interval_status='local_verification_required',
       clinical_review_status='verified',
       source_references=case p.parameter_code
         when 'UA_SPECIFIC_GRAVITY' then jsonb_build_array(jsonb_build_object('id','MAYO-SGUR-606565','title','Specific Gravity, Random, Urine','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/606565','method','Urine specific gravity; refractometry source.'))
         when 'UA_PH' then jsonb_build_array(jsonb_build_object('id','MAYO-PHU-606510','title','pH, Random, Urine','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/606510','scope','Random urine pH reference interval.'))
         when 'UA_RBC_HPF' then jsonb_build_array(jsonb_build_object('id','UIOWA-UAM','title','Urinalysis Microscopy','organization','University of Iowa Pathology Handbook','url','https://www.healthcare.uiowa.edu/path_handbook/rhandbook/test3139.html','method','Flow-through microscopy; RBC 0-2/HPF.'))
         when 'UA_WBC_HPF' then jsonb_build_array(jsonb_build_object('id','UIOWA-UAM','title','Urinalysis Microscopy','organization','University of Iowa Pathology Handbook','url','https://www.healthcare.uiowa.edu/path_handbook/rhandbook/test3139.html','method','Flow-through microscopy; WBC 0-5/HPF.'))
         when 'UA_SQUAMOUS' then jsonb_build_array(jsonb_build_object('id','UIOWA-UAM','title','Urinalysis Microscopy','organization','University of Iowa Pathology Handbook','url','https://www.healthcare.uiowa.edu/path_handbook/rhandbook/test3139.html','method','Flow-through microscopy; epithelial cells 0-2/HPF.'))
         when 'UA_TRANSITIONAL' then jsonb_build_array(jsonb_build_object('id','HUNTERDON-UA','title','Urinalysis','organization','Hunterdon Medical Center','url','https://hmc.testcatalog.org/show/UA','method','Microscopy; transitional epithelial cells 0-2/LPF.'))
         when 'UA_RENAL_EPITHELIAL' then jsonb_build_array(jsonb_build_object('id','HUNTERDON-UA','title','Urinalysis','organization','Hunterdon Medical Center','url','https://hmc.testcatalog.org/show/UA','method','Microscopy; renal epithelial cells 0-2/LPF.'))
         when 'UA_HYALINE_CASTS' then jsonb_build_array(jsonb_build_object('id','UIOWA-UAM','title','Urinalysis Microscopy','organization','University of Iowa Pathology Handbook','url','https://www.healthcare.uiowa.edu/path_handbook/rhandbook/test3139.html','method','Microscopy; casts 0-2/LPF.'))
         else jsonb_build_array(jsonb_build_object('id','AHS-UA-2023','title','Laboratory Medicine Major Changes: Urinalysis Reference Intervals','organization','Alberta Health Services','url','https://www.albertahealthservices.ca/assets/wf/lab/if-lab-appendix-a-major-changes-for-laboratory-medicine-with-connect-care-fully-launched-sites.pdf','scope','Normal absence of pathological casts.'))
       end,
       clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
         'reference_interval_source_type','external_source_suggested',
         'reference_interval_note','External laboratory comparison interval. Urine sediment methods and reporting units differ; verify local microscopy/instrument and reporting conventions before flagging.'
       )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='UA_COMPLETE'
   and p.parameter_code in ('UA_SPECIFIC_GRAVITY','UA_PH','UA_RBC_HPF','UA_WBC_HPF','UA_SQUAMOUS','UA_TRANSITIONAL','UA_RENAL_EPITHELIAL','UA_HYALINE_CASTS','UA_GRANULAR_CASTS','UA_WBC_CASTS','UA_RBC_CASTS','UA_WAXY_CASTS');

-- Culture colony counts are interpreted by organism, collection quality and symptoms,
-- not by one universal numeric reference interval.
update public.master_catalog_parameters p
   set reference_ranges=jsonb_build_array(jsonb_build_object(
         'text','Interpret with organism, collection method, specimen quality and symptoms. Mayo reports no growth, <10,000 CFU/mL or urogenital microbiota as no significant growth in its reporting context. >100,000 CFU/mL is generally significant, but symptomatic patients (especially children) may have UTI at lower counts.',
         'source','Mayo Clinic Laboratories Urine Culture (60515)',
         'population','Clinical interpretation; no single universal colony-count cutoff'
       )),
       reference_interval_status='local_verification_required',
       clinical_review_status='verified',
       source_references=jsonb_build_array(jsonb_build_object('id','MAYO-URNS-60515','title','Bacterial Culture, Aerobic, with Antimicrobial Susceptibilities, Urine','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/60515','scope','Colony count interpretation varies with organism, symptoms, age and specimen collection.')),
       clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
         'reference_interval_source_type','external_source_suggested',
         'reference_interval_note','Colony count is a clinical decision variable, not a normal reference interval. Do not use a single cutoff without organism, symptoms, age and collection context.'
       )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='CULTURE_URINE' and p.parameter_code='CU_COLONY_COUNT';

commit;
