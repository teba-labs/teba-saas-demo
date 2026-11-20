-- Verified basic calculated profiles with explicitly unit-bound equations.
insert into public.master_catalog_tests(
 release_id,master_code,canonical_name,alternate_names,test_kind,category,service_type,definition,clinical_review_status,source_name
)
select r.id,x.code,x.name,x.aliases,'panel','Clinical Chemistry','panel',x.definition,'verified',x.source
from public.master_catalog_releases r
cross join (values
 ('PROTEIN_PROFILE','Serum Protein Profile with A/G Ratio','{A/G ratio,Albumin/Globulin Ratio,Protein Profile}'::text[],
  jsonb_build_object('specimen','Serum','method','Validated total protein and albumin methods; calculated globulin and A/G ratio','reporting_notes','Globulin = total protein − albumin. A/G ratio = albumin ÷ globulin. All components must use the same concentration units. Calculated values are arithmetic indices, not independent measurements.','source_references',jsonb_build_array(jsonb_build_object('id','BEAUMONT-AG','title','Albumin Globulin Ratio — Corewell Health Laboratory','url','https://www.beaumontlaboratory.com/lab-test-directory/detail?URL=albumin-globulin-ratio&itemID=1','scope','A/G ratio is calculated from total protein and albumin'),jsonb_build_object('id','NCBI-ALBUMIN-GLOBULIN','title','Serum Albumin and Globulin','organization','NCBI Bookshelf','url','https://www.ncbi.nlm.nih.gov/books/NBK204/','scope','Globulin fraction calculated by subtracting albumin from total protein'))),
  'Corewell Health Laboratory; NCBI Bookshelf'),
 ('LIPID_PROFILE','Lipid Profile with Non-HDL Cholesterol','{Lipids Profile,Total Lipids,Cholesterol Profile}'::text[],
  jsonb_build_object('specimen','Serum or validated plasma','method','Validated enzymatic total cholesterol, triglyceride and HDL-C methods; LDL-C measured or estimated only by the laboratory validated equation','patient_preparation',jsonb_build_object('fasting','Record fasting status and duration; fasting is not mandatory for every clinical indication'),'reporting_notes','Non-HDL-C = total cholesterol − HDL-C and may be calculated in fasting or non-fasting samples. Do not calculate LDL-C by Friedewald by default: 2026 ACC/AHA guideline prefers Martin/Hopkins or Sampson/NIH equations; triglycerides ≥400 mg/dL require fasting assessment for LDL estimation. Use a separately validated algorithm if LDL-C is to be calculated.','source_references',jsonb_build_array(jsonb_build_object('id','ACC-AHA-DYSLIPIDEMIA-2026','title','2026 ACC/AHA Guideline on the Management of Dyslipidemia','year',2026,'doi','10.1016/j.jacc.2025.11.016','url','https://doi.org/10.1016/j.jacc.2025.11.016','scope','Non-HDL-C calculation and preferred LDL estimation methods'),jsonb_build_object('id','ADLM-LIPIDS-2024','title','ADLM Guidance Document on the Measurement and Reporting of Lipids and Lipoproteins','year',2024,'url','https://academic.oup.com/jalm/article/9/5/1040/7717178','scope','Lipid panel measurement and non-HDL calculation'))),
  '2026 ACC/AHA Dyslipidemia Guideline; ADLM Guidance'),
 ('HOMA_IR','HOMA-IR (HOMA1)','{HOMA-IR,Homeostasis Model Assessment of Insulin Resistance}'::text[],
  jsonb_build_object('specimen','Fasting plasma/serum glucose and fasting serum insulin','method','HOMA1 approximation; both samples must represent fasting steady-state measurements','patient_preparation',jsonb_build_object('fasting_required',true,'fasting_hours','Follow local clinical protocol and document fasting duration'),'reporting_notes','HOMA1-IR = fasting insulin (µIU/mL) × fasting glucose (mg/dL) ÷ 405. This profile is explicitly unit-bound to glucose mg/dL and insulin µIU/mL. Do not apply universal diagnostic cutoffs: published thresholds vary by population, age, sex, ethnicity, assay and clinical context. HOMA2 is a different nonlinear model and is not represented by this formula.','source_references',jsonb_build_array(jsonb_build_object('id','MATTHEWS-1985-HOMA','title','Homeostasis model assessment: insulin resistance and beta-cell function from fasting plasma glucose and insulin concentrations in man','organization','Diabetologia','year',1985,'doi','10.1007/BF00280883','url','https://bpb-us-w2.wpmucdn.com/sites.uab.edu/dist/2/579/files/2026/02/Matthews-HOMA-Paper-Diabetologia-1985.pdf','scope','Original HOMA1 model'),jsonb_build_object('id','HOMA-REVIEW-2004','title','Use and Abuse of HOMA Modeling','organization','Diabetes Care','year',2004,'doi','10.2337/diacare.27.6.1487','url','https://doi.org/10.2337/diacare.27.6.1487','scope','HOMA1 versus HOMA2 and model interpretation'))),
  'Matthews et al. 1985; Diabetes Care HOMA review 2004')
) as x(code,name,aliases,definition,source)
where r.version='taiba-core-2026.11.20-r1'
on conflict(release_id,master_code) do nothing;

with t as (
 select id,master_code from public.master_catalog_tests
 where release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
), p as (
 select * from (values
 ('PROTEIN_PROFILE','TOTAL_PROTEIN','Total protein','g/dL','numeric',2,'Measured inputs',10,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('PROTEIN_PROFILE','ALBUMIN','Albumin','g/dL','numeric',2,'Measured inputs',20,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('PROTEIN_PROFILE','GLOBULIN','Calculated globulin','g/dL','numeric',2,'Calculated results',30,'[]'::jsonb,'calculated','{"op":"subtract","args":[{"param":"TOTAL_PROTEIN"},{"param":"ALBUMIN"}]}'::jsonb,'local_verification_required',true),
 ('PROTEIN_PROFILE','AG_RATIO','Albumin / Globulin ratio','ratio','numeric',2,'Calculated results',40,'[]'::jsonb,'calculated','{"op":"divide","args":[{"param":"ALBUMIN"},{"param":"GLOBULIN"}]}'::jsonb,'local_verification_required',true),
 ('LIPID_PROFILE','TOTAL_CHOL','Total cholesterol','mg/dL','numeric',0,'Measured inputs',10,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('LIPID_PROFILE','TRIGLYCERIDES','Triglycerides','mg/dL','numeric',0,'Measured inputs',20,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('LIPID_PROFILE','HDL_C','HDL cholesterol','mg/dL','numeric',0,'Measured inputs',30,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('LIPID_PROFILE','LDL_C','LDL cholesterol (measured or validated estimate)','mg/dL','numeric',0,'Measured inputs',40,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',false),
 ('LIPID_PROFILE','NON_HDL_C','Non-HDL cholesterol','mg/dL','numeric',0,'Calculated results',50,'[]'::jsonb,'calculated','{"op":"subtract","args":[{"param":"TOTAL_CHOL"},{"param":"HDL_C"}]}'::jsonb,'local_verification_required',true),
 ('HOMA_IR','FASTING_GLUCOSE','Fasting glucose','mg/dL','numeric',0,'Measured inputs',10,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('HOMA_IR','FASTING_INSULIN','Fasting insulin','µIU/mL','numeric',2,'Measured inputs',20,'[]'::jsonb,'manual',null::jsonb,'local_verification_required',true),
 ('HOMA_IR','HOMA1_IR','HOMA1-IR','index','numeric',2,'Calculated results',30,'[]'::jsonb,'calculated','{"op":"divide","args":[{"op":"multiply","args":[{"param":"FASTING_GLUCOSE"},{"param":"FASTING_INSULIN"}]},{"const":405}]}'::jsonb,'local_verification_required',true)
 ) as v(test_code,parameter_code,parameter_name,unit,value_type,decimal_places,section,display_order,choices,result_source,formula,interval_status,is_required)
)
insert into public.master_catalog_parameters(
 master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,reference_ranges,choices,display_order,
 is_required,result_source,formula,clinical_metadata,source_references,clinical_review_status,reference_interval_status
)
select t.id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,'[]'::jsonb,p.choices,p.display_order,
 p.is_required,p.result_source,p.formula,jsonb_build_object('section',p.section,'group',p.section),
 case
  when t.master_code='PROTEIN_PROFILE' then jsonb_build_array(jsonb_build_object('id','NCBI-ALBUMIN-GLOBULIN','title','Serum Albumin and Globulin','url','https://www.ncbi.nlm.nih.gov/books/NBK204/'))
  when t.master_code='LIPID_PROFILE' then jsonb_build_array(jsonb_build_object('id','ACC-AHA-DYSLIPIDEMIA-2026','title','2026 ACC/AHA Guideline on the Management of Dyslipidemia','doi','10.1016/j.jacc.2025.11.016','url','https://doi.org/10.1016/j.jacc.2025.11.016'))
  else jsonb_build_array(jsonb_build_object('id','MATTHEWS-1985-HOMA','title','Homeostasis model assessment','doi','10.1007/BF00280883','url','https://bpb-us-w2.wpmucdn.com/sites.uab.edu/dist/2/579/files/2026/02/Matthews-HOMA-Paper-Diabetologia-1985.pdf'))
 end,
 'verified',p.interval_status
from t join p on p.test_code=t.master_code
on conflict(master_test_id,parameter_code) do nothing;
