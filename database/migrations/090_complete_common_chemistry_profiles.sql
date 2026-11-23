-- 090: Source-backed completion of common chemistry, renal, coagulation and HOMA profile parameters.
begin;

-- Remove the non-clinical placeholder from HOMA-IR. The profile's actual calculated
-- result is HOMA1_IR, already backed by its explicit glucose*insulin/405 formula.
delete from public.master_catalog_parameters p
 using public.master_catalog_tests t
 where p.master_test_id=t.id
   and t.master_code='HOMA_IR'
   and p.parameter_code='RESULT'
   and p.clinical_metadata->>'template_placeholder'='true';

-- HOMA inputs and calculated output.
update public.master_catalog_parameters p
   set reference_ranges = case p.parameter_code
     when 'FASTING_GLUCOSE' then jsonb_build_array(jsonb_build_object(
       'lower',70,'upper',99,'unit','mg/dL','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),
       'source','American Diabetes Association fasting plasma glucose criteria','population','Adults; fasting >=8 hours'
     ))
     when 'FASTING_INSULIN' then jsonb_build_array(jsonb_build_object(
       'lower',2.6,'upper',24.9,'unit','µIU/mL','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),
       'source','Mayo Clinic Laboratories Insulin, Serum (800257)','population','Adult comparison interval'
     ))
     when 'HOMA1_IR' then '[]'::jsonb
     else p.reference_ranges
   end,
   reference_interval_status=case when p.parameter_code='HOMA1_IR' then 'not_applicable' else 'local_verification_required' end,
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'FASTING_GLUCOSE' then jsonb_build_array(jsonb_build_object('id','ADA-FPG','title','Diabetes Diagnosis & Tests','organization','American Diabetes Association','url','https://diabetes.org/about-diabetes/diagnosis','scope','Fasting plasma glucose categories; fasting means at least 8 hours.'))
     when 'FASTING_INSULIN' then jsonb_build_array(jsonb_build_object('id','MAYO-INS-800257','title','Insulin, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800257/insulin-serum','method','Mayo method-specific serum insulin interval.'))
     when 'HOMA1_IR' then jsonb_build_array(jsonb_build_object('id','MATTHEWS-1985-HOMA','title','Homeostasis model assessment: insulin resistance and beta-cell function from fasting plasma glucose and insulin concentrations in man','organization','Matthews et al.','url','https://doi.org/10.1007/BF00280883','scope','HOMA1 calculation formula; no universal HOMA-IR diagnostic cutoff.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb) || jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note',case when p.parameter_code='HOMA1_IR' then 'No universal HOMA1-IR reference interval or diagnostic cutoff. Interpret using locally validated population-specific clinical decision limits; calculated automatically from fasting glucose and insulin.' else 'Source-based comparison interval; fasting status and local method verification required.' end,
     'method_notes',case when p.parameter_code='HOMA1_IR' then 'Calculated only: (FASTING_GLUCOSE * FASTING_INSULIN) / 405 when glucose is mg/dL and insulin is µIU/mL. Never request manual entry.' else 'Fasting specimen required for HOMA-IR profile.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='HOMA_IR'
   and p.parameter_code in ('FASTING_GLUCOSE','FASTING_INSULIN','HOMA1_IR');

-- Liver profile: complete GGT and direct bilirubin; calculated indices are explicitly
-- marked as having no single universal interval rather than leaving blank fields.
update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'GGT' then jsonb_build_array(
       jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',8,'upper',61,'unit','U/L','source','Mayo Clinic Laboratories GGT (8677)','population','Adult males'),
       jsonb_build_object('sex','female','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',5,'upper',36,'unit','U/L','source','Mayo Clinic Laboratories GGT (8677)','population','Adult females')
     )
     when 'BILIRUBIN_DIRECT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',1,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',0,'upper',0.3,'unit','mg/dL','source','Mayo Clinic Laboratories Direct Bilirubin (81787)','population','Age >=12 months; neonatal values not established'))
     when 'GLOBULIN' then '[]'::jsonb
     when 'AG_RATIO' then '[]'::jsonb
     else p.reference_ranges
   end,
   reference_interval_status=case when p.parameter_code in ('GLOBULIN','AG_RATIO') then 'not_applicable' else 'local_verification_required' end,
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'GGT' then jsonb_build_array(jsonb_build_object('id','MAYO-GGT-8677','title','Gamma-Glutamyltransferase (GGT), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8677','method','Mayo GGT serum assay; age- and sex-specific.'))
     when 'BILIRUBIN_DIRECT' then jsonb_build_array(jsonb_build_object('id','MAYO-BILID-81787','title','Bilirubin, Direct, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/81787','method','Photometric; protect specimen from light.'))
     when 'GLOBULIN' then jsonb_build_array(jsonb_build_object('id','DERIVED-GLOBULIN','title','Calculated globulin = total protein - albumin','organization','Taiba Smart Lab calculation definition','scope','Derived parameter; no independent universal reference interval is asserted.'))
     when 'AG_RATIO' then jsonb_build_array(jsonb_build_object('id','DERIVED-AG-RATIO','title','Calculated albumin/globulin ratio','organization','Taiba Smart Lab calculation definition','scope','Derived ratio; interpretation depends on component methods and local interval.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb) || jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note',case when p.parameter_code in ('GLOBULIN','AG_RATIO') then 'Derived parameter. No universal interval is asserted in the central library; interpret with measured total protein and albumin and the local method.' else 'Mayo Clinic Laboratories method-specific source interval; local analyzer/reagent verification required.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='LIVER_PROFILE'
   and p.parameter_code in ('GGT','BILIRUBIN_DIRECT','GLOBULIN','AG_RATIO');

-- Iron profile: transferrin.
update public.master_catalog_parameters p
   set reference_ranges=jsonb_build_array(jsonb_build_object('lower',200,'upper',360,'unit','mg/dL','source','Mayo Clinic Laboratories Transferrin, Serum (800154)','population','Adult comparison interval')),
       reference_interval_status='local_verification_required',
       clinical_review_status='verified',
       source_references=jsonb_build_array(jsonb_build_object('id','MAYO-TRSF-800154','title','Transferrin, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800154','method','Roche turbidimetric assay; transferrin is a negative acute-phase reactant.')),
       clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo source interval; pregnancy, oral contraceptives, inflammation, nutrition and liver disease affect interpretation.')
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='IRON_PROFILE' and p.parameter_code='TRANSFERRIN';

-- Coagulation profile.
update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'FIBRINOGEN' then jsonb_build_array(jsonb_build_object('lower',200,'upper',393,'unit','mg/dL','source','Mayo Clinic Laboratories Fibrinogen, Plasma (40937)','population','Adult plasma; method-specific'))
     when 'D_DIMER' then jsonb_build_array(jsonb_build_object('lower',0,'upper',500,'unit','ng/mL FEU','source','Mayo Clinic Laboratories D-Dimer, Plasma (602174)','population','Standard adult FEU cutoff; interpret with pretest probability and age-adjusted strategies where indicated'))
     else p.reference_ranges
   end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'FIBRINOGEN' then jsonb_build_array(jsonb_build_object('id','MAYO-FIBTP-40937','title','Fibrinogen, Plasma','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/40937','method','Functional plasma fibrinogen; method-specific.'))
     when 'D_DIMER' then jsonb_build_array(jsonb_build_object('id','MAYO-DIMER-602174','title','D-Dimer, Plasma','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602174','method','FEU reporting; cutoff must match assay units.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo method- and unit-specific comparison interval; local assay verification required.')
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='COAG_PROFILE' and p.parameter_code in ('FIBRINOGEN','D_DIMER');

-- Kidney profile: uric acid and eGFR. Urea is converted from the Mayo BUN interval
-- using the molecular-weight conversion (urea mg/dL = BUN mg/dL x 2.14).
update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'UREA' then jsonb_build_array(
       jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',17.1,'upper',51.4,'unit','mg/dL','source','Mayo Clinic Laboratories BUN (81793), converted BUN x 2.14','population','Adult males; calculated urea interval'),
       jsonb_build_object('sex','female','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',12.8,'upper',44.9,'unit','mg/dL','source','Mayo Clinic Laboratories BUN (81793), converted BUN x 2.14','population','Adult females; calculated urea interval')
     )
     when 'URIC_ACID' then jsonb_build_array(
       jsonb_build_object('sex','male','age',jsonb_build_object('min',16,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',3.7,'upper',8.0,'unit','mg/dL','source','Mayo Clinic Laboratories Uric Acid, Serum (8440)','population','Males >=16 years'),
       jsonb_build_object('sex','female','age',jsonb_build_object('min',13,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',2.7,'upper',6.1,'unit','mg/dL','source','Mayo Clinic Laboratories Uric Acid, Serum (8440)','population','Females >=13 years')
     )
     when 'EGFR' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',60,'unit','mL/min/1.73 m²','source','Mayo Clinic Laboratories Basic Metabolic Panel (113630); 2021 CKD-EPI','population','Adults >=18 years; eGFR >=60 is not by itself proof of normal kidney function'))
     else p.reference_ranges
   end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'UREA' then jsonb_build_array(jsonb_build_object('id','MAYO-BUN-81793','title','Blood Urea Nitrogen (BUN), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/81793','scope','Urea values converted from BUN by molecular-weight ratio 60/28 = 2.14.'))
     when 'URIC_ACID' then jsonb_build_array(jsonb_build_object('id','MAYO-URIC-8440','title','Uric Acid, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8440','method','Colorimetric uricase method; age- and sex-specific.'))
     when 'EGFR' then jsonb_build_array(jsonb_build_object('id','MAYO-BMP-113630','title','Basic Metabolic Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/113630','scope','2021 CKD-EPI creatinine equation; adults >=18 years.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note',case when p.parameter_code='EGFR' then 'Clinical staging requires CKD context and persistence; interpret with albuminuria and clinical history.' when p.parameter_code='UREA' then 'Converted from BUN by 2.14; confirm reporting convention because serum urea and BUN are not interchangeable units.' else 'Mayo source interval; method, age and sex specific; local verification required.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='KIDNEY_PROFILE' and p.parameter_code in ('UREA','URIC_ACID','EGFR');

commit;
