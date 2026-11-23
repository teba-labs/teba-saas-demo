-- 091: Complete the lipid profile with Mayo/NCEP adult and pediatric decision categories.
begin;

update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'TOTAL_CHOL' then jsonb_build_array(
       jsonb_build_object('text','Adults >=18 y: Desirable <200 mg/dL; Borderline high 200–239 mg/dL; High >=240 mg/dL. Ages 2–17 y: Acceptable <170 mg/dL; Borderline high 170–199 mg/dL; High >=200 mg/dL.','source','Mayo Clinic Laboratories Lipid Panel (616696) / NCEP','population','Clinical decision categories; age-specific')
     )
     when 'TRIGLYCERIDES' then jsonb_build_array(
       jsonb_build_object('text','Adults >=18 y: Normal <150 mg/dL; Borderline high 150–199 mg/dL; High 200–499 mg/dL; Very high >=500 mg/dL. Ages 2–9 y: Acceptable <75; Borderline 75–99; High >=100 mg/dL. Ages 10–17 y: Acceptable <90; Borderline 90–129; High >=130 mg/dL.','source','Mayo Clinic Laboratories Lipid Panel (616696) / NCEP pediatric panel guidance','population','Clinical decision categories; age-specific')
     )
     when 'HDL_C' then jsonb_build_array(
       jsonb_build_object('sex','male','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',40,'unit','mg/dL','source','Mayo Clinic Laboratories Lipid Panel (616696)','population','Adult males; >=40 mg/dL'),
       jsonb_build_object('sex','female','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',50,'unit','mg/dL','source','Mayo Clinic Laboratories Lipid Panel (616696)','population','Adult females; >=50 mg/dL')
     )
     when 'LDL_C' then jsonb_build_array(
       jsonb_build_object('text','Adults: Desirable <100 mg/dL; Above desirable 100–129 mg/dL; Borderline high 130–159 mg/dL; High 160–189 mg/dL; Very high >=190 mg/dL. Pediatric 2–17 y: Acceptable <110 mg/dL; Borderline 110–129 mg/dL; High >=130 mg/dL. Treatment targets depend on ASCVD risk and current guideline; calculated LDL is not applicable with very high triglycerides.','source','Mayo Clinic Laboratories Lipid Panel (616696); NCEP decision categories','population','Clinical decision categories; risk-based treatment targets are not a universal reference interval')
     )
     when 'NON_HDL_C' then jsonb_build_array(
       jsonb_build_object('text','Adults: Desirable <130 mg/dL; Above desirable 130–159 mg/dL; Borderline high 160–189 mg/dL; High 190–219 mg/dL; Very high >=220 mg/dL. Pediatric 2–17 y: Acceptable <120 mg/dL; Borderline 120–144 mg/dL; High >=145 mg/dL. Treatment goals depend on cardiovascular risk.','source','Mayo Clinic Laboratories Lipid Panel (616696); NCEP decision categories','population','Calculated clinical decision categories')
     )
     else p.reference_ranges
   end,
   reference_interval_status='local_verification_required',
   clinical_review_status='verified',
   source_references=jsonb_build_array(
     jsonb_build_object('id','MAYO-LPSC1-616696','title','Lipid Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/616696','scope','Adult and pediatric clinical decision categories; calculated LDL and non-HDL; method details.'),
     jsonb_build_object('id','NHLBI-ATP-III','title','ATP III Guidelines At-A-Glance Quick Desk Reference','organization','National Heart, Lung, and Blood Institute','url','https://www.nhlbi.nih.gov/files/docs/guidelines/atglance.pdf','scope','LDL, total cholesterol and HDL classifications; historical decision categories, not individualized treatment targets.')
   ),
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note','These are cardiovascular risk decision categories, not universal laboratory reference intervals or patient-specific treatment targets. Interpret with age, sex, ASCVD risk, diabetes, hypertension and clinical history; verify local assay and current guideline.',
     'method_notes',case when p.parameter_code in ('NON_HDL_C','LDL_C') then 'Calculated result; never request manual entry when formula is available. Calculated LDL may be invalid at very high triglyceride concentrations.' else 'Colorimetric measurement in source profile; fasting status and local assay requirements apply.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='LIPID_PROFILE'
   and p.parameter_code in ('TOTAL_CHOL','TRIGLYCERIDES','HDL_C','LDL_C','NON_HDL_C');

commit;
