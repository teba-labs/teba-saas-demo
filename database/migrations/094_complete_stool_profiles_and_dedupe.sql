-- 094: Complete routine stool examination and remove duplicate stool-culture result fields.
begin;

update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'ST_RBC' then jsonb_build_array(jsonb_build_object(
       'text','Normally not seen. Report according to the laboratory microscopy method (not seen / few / moderate / many or a validated count). No universal numeric HPF cutoff is asserted across laboratories.',
       'source','Microscopic examination of stool; normal stool does not contain intact erythrocytes',
       'population','Fresh stool; microscopy'
     ))
     when 'ST_WBC' then jsonb_build_array(jsonb_build_object(
       'text','Normally not seen. Report according to the laboratory microscopy method. Fecal leukocyte microscopy is method-dependent and is not sufficiently sensitive to determine the cause of acute infectious diarrhea.',
       'source','The importance of stool tests in diagnosis and follow-up of gastrointestinal disorders (2019); IDSA infectious diarrhea guideline',
       'population','Fresh stool; microscopy'
     ))
     when 'ST_PH' then jsonb_build_array(jsonb_build_object(
       'text','Usually neutral to weakly alkaline (approximately pH 7.0–7.5 in traditional stool-analysis references); diet, age, specimen handling and method affect the result. No universal diagnostic cutoff.',
       'source','Manual of Laboratory and Diagnostic Tests, Stool Analysis reference values',
       'population','Stool suspension; method-dependent'
     ))
     else p.reference_ranges
   end,
   reference_interval_status='not_applicable',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'ST_RBC' then jsonb_build_array(jsonb_build_object('id','PMC6776453','title','The importance of stool tests in diagnosis and follow-up of gastrointestinal disorders in children','organization','World Journal of Gastroenterology / PMC','url','https://pmc.ncbi.nlm.nih.gov/articles/PMC6776453/','scope','Intact erythrocytes are not observed in normal stool; report method-dependent.'))
     when 'ST_WBC' then jsonb_build_array(jsonb_build_object('id','PMC6776453','title','The importance of stool tests in diagnosis and follow-up of gastrointestinal disorders in children','organization','World Journal of Gastroenterology / PMC','url','https://pmc.ncbi.nlm.nih.gov/articles/PMC6776453/','scope','Normal stool does not show leukocytes; sensitivity and cutoffs vary.'))
     when 'ST_PH' then jsonb_build_array(jsonb_build_object('id','FISCHBACH-STOOL-ANALYSIS','title','Manual of Laboratory and Diagnostic Tests - Stool Analysis','organization','Fischbach and Dunning','url','https://library.uniq.edu.iq/storage/books/file/%5BFrances_Fischbach%2C_Marshall_B._Dunning%5D_A_Manual_%28BookSee.org%29-2/1666250504%5BFrances_Fischbach%2C_Marshall_B._Dunning%5D_A_Manual_%28BookSee.org%29-2.pdf','scope','Traditional stool pH reference description; method and diet dependent.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
     'reference_interval_note','This parameter does not have a universal numeric reference interval across laboratories. The sourced expected finding is displayed for clinical context; do not auto-flag without a locally validated method.',
     'reference_interval_source_type','qualitative_expected_finding'
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='STOOL_EXAM'
   and p.parameter_code in ('ST_RBC','ST_WBC','ST_PH');

-- Remove duplicate result fields from the central stool-culture profile. Keep the
-- CS_* canonical fields so each result is entered exactly once.
delete from public.master_catalog_parameters p
 using public.master_catalog_tests t
 where p.master_test_id=t.id
   and t.master_code='CULTURE_STOOL'
   and p.parameter_code in ('CULTURE_GROWTH','CULTURE_IDENTIFICATION','CULTURE_AST_COMMENT','CULTURE_REPORT_COMMENT');

commit;
