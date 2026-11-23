-- 093: Complete CBC differential/indices with sourced intervals and calculated plateletcrit.
begin;

update public.master_catalog_parameters p
   set reference_ranges=case p.parameter_code
     when 'MCH' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',27,'upper',32,'unit','pg','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults >=18 years; MCH 27-32 pg'))
     when 'MCHC' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',31.5,'upper',34.5,'unit','g/dL','source','University Hospitals Dorset Adult FBC Reference Ranges (315-345 g/L)','population','Adults >=18 years; converted g/L to g/dL'))
     when 'RDW_SD' then jsonb_build_array(jsonb_build_object('text','Analyzer-specific parameter. Use the manufacturer- and instrument-validated RDW-SD interval; no universal cross-platform interval is asserted.','source','Analyzer-specific CBC parameter','population','All ages; local analyzer verification required'))
     when 'MPV' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',9,'upper',13,'unit','fL','source','Oxford University Hospitals Haematology Handbook','population','Adult comparison interval; analyzer-specific'))
     when 'PDW' then jsonb_build_array(jsonb_build_object('text','Analyzer-specific platelet distribution width. Use the exact hematology analyzer manufacturer interval; do not transfer PDW limits between analyzer platforms.','source','Instrument-dependent platelet histogram parameter','population','All ages; local analyzer verification required'))
     when 'PCT' then '[]'::jsonb
     when 'NEUT_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',40,'upper',80,'unit','%','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults; percentage differential'))
     when 'LYMPH_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',20,'upper',40,'unit','%','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults; percentage differential'))
     when 'MONO_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',2,'upper',10,'unit','%','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults; percentage differential'))
     when 'EOS_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',1,'upper',6,'unit','%','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults; percentage differential'))
     when 'BASO_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',0,'upper',2,'unit','%','source','University Hospitals Dorset Adult FBC Reference Ranges','population','Adults; percentage differential'))
     when 'NRBC_PCT' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',0,'upper',0.2,'unit','/100 WBC','source','Oxford University Hospitals Haematology Handbook','population','Adults; neonatal/pediatric NRBC interpretation differs'))
     else p.reference_ranges
   end,
   result_source=case when p.parameter_code='PCT' then 'calculated' else p.result_source end,
   formula=case when p.parameter_code='PCT' then jsonb_build_object('op','divide','args',jsonb_build_array(jsonb_build_object('op','multiply','args',jsonb_build_array(jsonb_build_object('param','PLT'),jsonb_build_object('param','MPV'))),jsonb_build_object('const',10000))) else p.formula end,
   formula_expression=case when p.parameter_code='PCT' then '((PLT * MPV) / 10000)' else p.formula_expression end,
   reference_interval_status=case when p.parameter_code in ('RDW_SD','PDW') then 'not_applicable' when p.parameter_code='PCT' then 'not_applicable' else 'local_verification_required' end,
   clinical_review_status='verified',
   source_references=case p.parameter_code
     when 'MCH' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult MCH 27-32 pg; pediatric ranges differ.'))
     when 'MCHC' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult MCHC 315-345 g/L; converted to g/dL.'))
     when 'RDW_SD' then jsonb_build_array(jsonb_build_object('id','RDW-SD-INSTRUMENT','title','RDW-SD instrument-specific interval','organization','Taiba Smart Lab clinical data note','scope','No universal cross-platform interval; local analyzer insert is required.'))
     when 'MPV' then jsonb_build_array(jsonb_build_object('id','OUH-HAEM-HANDBOOK','title','Department of Laboratory Haematology Handbook','organization','Oxford University Hospitals NHS Foundation Trust','url','https://www.ouh.nhs.uk/services/departments/laboratory-medicine/haematology-laboratories/documents/haematology-handbook.pdf','scope','Adult MPV 9-13 fL; analyzer-specific.'))
     when 'PDW' then jsonb_build_array(jsonb_build_object('id','PDW-INSTRUMENT','title','PDW instrument-specific interval','organization','Taiba Smart Lab clinical data note','scope','No universal cross-platform interval; local analyzer insert is required.'))
     when 'PCT' then jsonb_build_array(jsonb_build_object('id','PCT-CALC','title','Plateletcrit calculation','organization','Taiba Smart Lab calculation definition','scope','PCT (%) = platelet count (10^9/L) x MPV (fL) / 10000.'))
     when 'NEUT_PCT' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult differential percentage; pediatric distribution differs.'))
     when 'LYMPH_PCT' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult differential percentage; pediatric distribution differs.'))
     when 'MONO_PCT' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult differential percentage; pediatric distribution differs.'))
     when 'EOS_PCT' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult differential percentage; pediatric distribution differs.'))
     when 'BASO_PCT' then jsonb_build_array(jsonb_build_object('id','UHD-ADULT-FBC','title','Test Repertoire and Reference Ranges','organization','University Hospitals Dorset','url','https://www.uhd.nhs.uk/services/pathology/haematology/test-repertoire-and-reference-ranges','scope','Adult differential percentage; pediatric distribution differs.'))
     when 'NRBC_PCT' then jsonb_build_array(jsonb_build_object('id','OUH-HAEM-HANDBOOK','title','Department of Laboratory Haematology Handbook','organization','Oxford University Hospitals NHS Foundation Trust','url','https://www.ouh.nhs.uk/services/departments/laboratory-medicine/haematology-laboratories/documents/haematology-handbook.pdf','scope','Adult NRBC 0-0.2%; neonatal and pediatric interpretation differs.'))
     else p.source_references
   end,
   clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object(
     'reference_interval_source_type','external_source_suggested',
     'reference_interval_note',case when p.parameter_code in ('RDW_SD','PDW') then 'Analyzer-specific. No universal interval is asserted; configure the exact analyzer/reagent interval locally.' when p.parameter_code='PCT' then 'Calculated automatically from PLT and MPV. No manual result entry; reference limits are analyzer-dependent.' else 'External adult comparison interval. Pediatric ranges and local analyzer verification are required before clinical flagging.' end,
     'method_notes',case when p.parameter_code='PCT' then 'Calculated: (PLT * MPV) / 10000; do not request manual entry.' else 'Hematology analyzer-specific; local verification required.' end
   )
  from public.master_catalog_tests t
 where p.master_test_id=t.id and t.master_code='HEM_CBC'
   and p.parameter_code in ('MCH','MCHC','RDW_SD','MPV','PDW','PCT','NEUT_PCT','LYMPH_PCT','MONO_PCT','EOS_PCT','BASO_PCT','NRBC_PCT');

commit;
