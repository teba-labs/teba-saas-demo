-- 097: Finish serum protein and WHO 6th edition semen analysis intervals.
begin;

update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'GLOBULIN' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',20,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',1.9,'upper',3.7,'unit','g/dL','source','Quest Diagnostics Protein, Total and Albumin (7577)','population','Adult males; calculated globulin'),jsonb_build_object('sex','female','age',jsonb_build_object('min',20,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',1.9,'upper',3.7,'unit','g/dL','source','Quest Diagnostics Protein, Total and Albumin (7577)','population','Adult females; calculated globulin'))
     when 'AG_RATIO' then jsonb_build_array(jsonb_build_object('lower',1.0,'upper',2.5,'unit','ratio','source','Quest Diagnostics Protein, Total and Albumin (7577)','population','Calculated ratio; method-specific.'))
     else p.reference_ranges end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'GLOBULIN' then jsonb_build_array(jsonb_build_object('id','QUEST-7577','title','Protein, Total and Albumin','organization','Quest Diagnostics','url','https://testdirectory.questdiagnostics.com/test/test-detail/7577/protein-total-and-albumin','scope','Calculated globulin 1.9–3.7 g/dL in adults.'))
     when 'AG_RATIO' then jsonb_build_array(jsonb_build_object('id','QUEST-7577','title','Protein, Total and Albumin','organization','Quest Diagnostics','url','https://testdirectory.questdiagnostics.com/test/test-detail/7577/protein-total-and-albumin','scope','Calculated albumin/globulin ratio 1.0–2.5.'))
     else p.source_references end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Quest adult comparison intervals for calculated values; local method verification required.','method_notes','Calculated only: globulin = total protein - albumin; A/G ratio = albumin / globulin.')
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='PROTEIN_PROFILE'
   and p.parameter_code in ('GLOBULIN','AG_RATIO');

update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'ABSTINENCE_DAYS' then jsonb_build_array(jsonb_build_object('lower',2,'upper',7,'unit','days','source','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021)','population','Recommended abstinence interval before semen collection.'))
     when 'SEMEN_LIQUEFACTION' then jsonb_build_array(jsonb_build_object('lower',0,'upper',60,'unit','minutes','source','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021)','population','Complete liquefaction within 60 minutes.'))
     when 'ROUND_CELLS' then jsonb_build_array(jsonb_build_object('text','If round cells exceed 1.0 million/mL, differentiate leukocytes from immature germ cells (e.g. peroxidase stain). Round cells are not equivalent to leukocytes; do not use this as a leukocyte count.','source','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021)','population','Interpret with peroxidase-positive leukocyte count.'))
     when 'PEROXIDASE_LEUKOCYTES' then jsonb_build_array(jsonb_build_object('lower',0,'upper',1.0,'unit','million/mL','source','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021)','population','Peroxidase-positive leukocytes; >1.0 million/mL is leukocytospermia threshold.'))
     else p.reference_ranges end,
   reference_interval_status=case when p.parameter_code='ROUND_CELLS' then 'not_applicable' else 'local_verification_required' end,
   clinical_review_status='verified',
   source_references=jsonb_build_array(jsonb_build_object('id','WHO-SEmen-6E-2021','title','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition','organization','World Health Organization','url','https://www.who.int/publications/i/item/9789240030787','scope','Collection, abstinence, liquefaction, leukocytes and semen analysis procedures.'),
   jsonb_build_object('id','EAU-SEmen-2026','title','EAU Guidelines on Sexual and Reproductive Health 2026','organization','European Association of Urology','url','https://d56bochluxqnz.cloudfront.net/documents/full-guideline/EAU-Guidelines-on-Sexual-and-Reproductive-Health-2026.pdf','scope','WHO 2021 lower fifth percentile values; these are not diagnostic infertility cutoffs.')),
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
     'reference_interval_source_type','WHO_6th_edition_reference_or_decision_limit',
     'reference_interval_note',case when p.parameter_code='ROUND_CELLS' then 'Round cells include leukocytes and immature germ cells. >1 million/mL triggers differentiation; it is not a leukocyte reference range.' else 'WHO 6th edition reference/decision limit. These lower reference limits do not independently diagnose infertility; interpret the full semen profile and clinical context.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='SEMEN_ANALYSIS'
   and p.parameter_code in ('ABSTINENCE_DAYS','SEMEN_LIQUEFACTION','ROUND_CELLS','PEROXIDASE_LEUKOCYTES');

commit;
