-- 089: Complete source-backed adult reproductive hormone profiles.
-- Intervals remain external suggestions until each tenant verifies its own assay.
begin;

update public.master_catalog_tests t
   set clinical_review_status = 'verified',
       source_name = 'Mayo Clinic Laboratories public test catalog; CLSI EP28 reference-interval verification guidance',
       definition = coalesce(t.definition,'{}'::jsonb) || jsonb_build_object(
         'specimen','Serum',
         'method','Roche Elecsys electrochemiluminescence immunoassay (ECLIA) source-aligned profile; individual analytes may require assay-specific methods as stated in parameter notes.',
         'reporting_notes','Reference intervals are source-backed external comparison suggestions, not universal intervals. Verify the exact analyzer, reagent generation, calibration, units and local reference interval before clinical reporting. Menstrual-cycle phase, menopause and pregnancy status must be considered where stated.',
         'clinical_review_note','Structured adult profile reviewed against the cited Mayo Clinic Laboratories test catalog entries. Reference interval status intentionally remains local_verification_required until the tenant verifies its own method and population.',
         'source_references',jsonb_build_array(
           jsonb_build_object('id','MAYO-FSH-602753','organization','Mayo Clinic Laboratories','title','Follicle-Stimulating Hormone (FSH), Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/602753','scope','Adult male and female cycle-phase reference values; Roche FSH assay method.'),
           jsonb_build_object('id','MAYO-LH-602752','organization','Mayo Clinic Laboratories','title','Luteinizing Hormone (LH), Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/602752','scope','Adult male and female cycle-phase reference values; ECLIA method.'),
           jsonb_build_object('id','MAYO-ESTS-8575','organization','Mayo Clinic Laboratories','title','Estradiol, Rapid, Immunoassay, Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/8575','scope','ECLIA method; adult male and female reference values.'),
           jsonb_build_object('id','MAYO-PGSN-8141','organization','Mayo Clinic Laboratories','title','Progesterone, Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/8141','scope','Roche Elecsys Progesterone III ECLIA; cycle and pregnancy values.'),
           jsonb_build_object('id','MAYO-PRL-800091','organization','Mayo Clinic Laboratories','title','Prolactin, Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/800091','scope','Roche Elecsys Prolactin II ECLIA; adult sex-specific reference values.'),
           jsonb_build_object('id','MAYO-TTST-8533','organization','Mayo Clinic Laboratories','title','Testosterone, Total, Mass Spectrometry, Serum','url','https://www.mayocliniclabs.com/test-catalog/overview/8533','scope','Adult male total testosterone reference values; LC-MS/MS method.'),
           jsonb_build_object('id','CLSI-EP28','organization','Clinical and Laboratory Standards Institute','title','Defining, Establishing, and Verifying Reference Intervals','url','https://clsi.org/shop/standards/ep28/','scope','Local verification of method-specific reference intervals.')
         )
       ),
       updated_at = now()
  from public.master_catalog_releases r
 where r.id=t.release_id
   and r.version='taiba-core-2026.11.20-r1'
   and t.master_code in ('FEMALE_CYCLE_HORMONE_PROFILE','MALE_FERTILITY_HORMONE_PROFILE');

-- Female cycle profile: keep phase-dependent intervals visible as one sourced text range.
-- This avoids falsely selecting a menstrual phase that the current patient record does not capture.
update public.master_catalog_parameters p
   set reference_ranges = case p.parameter_code
     when 'FSH' then jsonb_build_array(jsonb_build_object(
       'text','Follicular phase: 2.9–14.6 IU/L; Midcycle: 4.7–23.2 IU/L; Luteal phase: 1.4–8.9 IU/L; Postmenopausal: 16.0–157.0 IU/L',
       'source','Mayo Clinic Laboratories FSH, Serum (602753)',
       'population','Adult females; menstrual-cycle phase must be interpreted clinically'
     ))
     when 'LH' then jsonb_build_array(jsonb_build_object(
       'text','Follicular phase: 1.9–14.6 IU/L; Midcycle: 12.2–118.0 IU/L; Luteal phase: 0.7–12.9 IU/L; Postmenopausal: 5.3–65.4 IU/L',
       'source','Mayo Clinic Laboratories LH, Serum (602752)',
       'population','Adult females; menstrual-cycle phase must be interpreted clinically'
     ))
     when 'ESTRADIOL' then jsonb_build_array(jsonb_build_object(
       'text','Premenopausal: 15–350 pg/mL; Postmenopausal: <10 pg/mL. Concentrations vary widely during the menstrual cycle; low concentrations may require mass spectrometry.',
       'source','Mayo Clinic Laboratories Estradiol Rapid, Immunoassay (8575)',
       'population','Adult females; ECLIA; assay quantitation and clinical context apply'
     ))
     when 'PROGESTERONE' then jsonb_build_array(jsonb_build_object(
       'text','Follicular: ≤0.89 ng/mL; Ovulation: ≤12 ng/mL; Luteal: 1.8–24 ng/mL; Postmenopausal: ≤0.20 ng/mL; Pregnancy 1st trimester: 11–44 ng/mL; 2nd trimester: 25–83 ng/mL; 3rd trimester: 58–214 ng/mL',
       'source','Mayo Clinic Laboratories Progesterone, Serum (8141)',
       'population','Adult females; cycle day and pregnancy trimester are essential for interpretation'
     ))
     when 'PROLACTIN' then jsonb_build_array(
       jsonb_build_object('sex','female','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',4.8,'upper',23.3,'unit','ng/mL','source','Mayo Clinic Laboratories Prolactin, Serum (800091)','population','Adult females'),
       jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',4.0,'upper',15.2,'unit','ng/mL','source','Mayo Clinic Laboratories Prolactin, Serum (800091)','population','Adult males')
     )
     else p.reference_ranges
   end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'FSH' then jsonb_build_array(jsonb_build_object('id','MAYO-FSH-602753','title','Follicle-Stimulating Hormone (FSH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602753','method','Roche FSH assay; ECLIA'))
     when 'LH' then jsonb_build_array(jsonb_build_object('id','MAYO-LH-602752','title','Luteinizing Hormone (LH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602752','method','Electrochemiluminescence immunoassay'))
     when 'ESTRADIOL' then jsonb_build_array(jsonb_build_object('id','MAYO-ESTS-8575','title','Estradiol, Rapid, Immunoassay, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8575','method','Roche cobas e801 ECLIA; low values require method caution'))
     when 'PROGESTERONE' then jsonb_build_array(jsonb_build_object('id','MAYO-PGSN-8141','title','Progesterone, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8141','method','Roche Cobas e801 Progesterone III ECLIA'))
     when 'PROLACTIN' then jsonb_build_array(jsonb_build_object('id','MAYO-PRL-800091','title','Prolactin, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800091','method','Roche Elecsys Prolactin II ECLIA'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb) || jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note','Mayo Clinic Laboratories source values. Not locally verified for a tenant analyzer/reagent; do not automatically flag until local verification.',
     'method_notes','Roche Elecsys ECLIA source method unless the individual analyte reference specifies otherwise.'
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id
   and t.master_code='FEMALE_CYCLE_HORMONE_PROFILE'
   and p.parameter_code in ('FSH','LH','ESTRADIOL','PROGESTERONE','PROLACTIN');

-- Male fertility profile: age/sex-specific numeric intervals where the source provides them.
update public.master_catalog_parameters p
   set reference_ranges = case p.parameter_code
     when 'FSH' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',1.2,'upper',15.8,'unit','IU/L','source','Mayo Clinic Laboratories FSH, Serum (602753)','population','Adult males'))
     when 'LH' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',1.3,'upper',9.6,'unit','IU/L','source','Mayo Clinic Laboratories LH, Serum (602752)','population','Adult males'))
     when 'TESTOSTERONE_TOTAL' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',19,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',240,'upper',950,'unit','ng/dL','source','Mayo Clinic Laboratories Testosterone, Total, Mass Spectrometry (8533)','population','Adult males; LC-MS/MS'))
     when 'PROLACTIN' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',4.0,'upper',15.2,'unit','ng/mL','source','Mayo Clinic Laboratories Prolactin, Serum (800091)','population','Adult males'))
     when 'ESTRADIOL' then jsonb_build_array(jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',10,'upper',40,'unit','pg/mL','source','Mayo Clinic Laboratories Estradiol Rapid, Immunoassay (8575)','population','Adult males; ECLIA; low concentrations require mass spectrometry'))
     else p.reference_ranges
   end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'FSH' then jsonb_build_array(jsonb_build_object('id','MAYO-FSH-602753','title','Follicle-Stimulating Hormone (FSH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602753','method','Roche FSH assay; ECLIA'))
     when 'LH' then jsonb_build_array(jsonb_build_object('id','MAYO-LH-602752','title','Luteinizing Hormone (LH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602752','method','Electrochemiluminescence immunoassay'))
     when 'TESTOSTERONE_TOTAL' then jsonb_build_array(jsonb_build_object('id','MAYO-TTST-8533','title','Testosterone, Total, Mass Spectrometry, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8533','method','LC-MS/MS'))
     when 'PROLACTIN' then jsonb_build_array(jsonb_build_object('id','MAYO-PRL-800091','title','Prolactin, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800091','method','Roche Elecsys Prolactin II ECLIA'))
     when 'ESTRADIOL' then jsonb_build_array(jsonb_build_object('id','MAYO-ESTS-8575','title','Estradiol, Rapid, Immunoassay, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8575','method','Roche cobas e801 ECLIA'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb) || jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note','Mayo Clinic Laboratories method-specific source values. Not locally verified for a tenant analyzer/reagent; do not automatically flag until local verification.',
     'method_notes',case when p.parameter_code='TESTOSTERONE_TOTAL' then 'LC-MS/MS; immunoassay-derived intervals must not be substituted.' else 'Roche Elecsys ECLIA source method unless the individual analyte reference specifies otherwise.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id
   and t.master_code='MALE_FERTILITY_HORMONE_PROFILE'
   and p.parameter_code in ('FSH','LH','TESTOSTERONE_TOTAL','PROLACTIN','ESTRADIOL');

commit;
