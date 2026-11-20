-- Additional common chemistry, endocrine, iron and coagulation panels.
insert into public.master_catalog_tests(release_id,master_code,canonical_name,alternate_names,test_kind,category,service_type,definition,clinical_review_status,source_name)
select r.id,x.code,x.name,x.aliases,'panel',x.category,'panel',x.definition,'verified',x.sources
from public.master_catalog_releases r
cross join (values
 ('KIDNEY_PROFILE','Kidney Function Profile','{Kidney Functions,Renal Function Tests}'::text[],'Clinical Chemistry',
  jsonb_build_object('specimen','Serum; urine where separately requested','method','Validated chemistry analyzer methods','reporting_notes','eGFR is reported only when the laboratory has verified the applicable equation, standardized creatinine method, adult age and sex inputs. This release leaves eGFR as a manual field; do not substitute a generic range.','source_references',jsonb_build_array(jsonb_build_object('id','NIDDK-EGFR-2021','title','eGFR Equations for Adults','organization','NIDDK','url','https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/adults','scope','2021 CKD-EPI adult equations, IDMS-traceable creatinine and demographic applicability'),jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals','organization','CLSI','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/','scope','Local reference interval verification'))),
  'NIDDK; CLSI EP28'),
 ('LIVER_PROFILE','Liver Function Profile','{Liver Functions,LFT,تقييم وظائف الكبد}'::text[],'Clinical Chemistry',
  jsonb_build_object('specimen','Serum','method','Validated chemistry analyzer methods','reporting_notes','Globulin and A/G ratio are calculated from total protein and albumin in matching units. Bilirubin fractions and enzyme activities are method-specific.','source_references',jsonb_build_array(jsonb_build_object('id','NCBI-ALBUMIN-GLOBULIN','title','Serum Albumin and Globulin','url','https://www.ncbi.nlm.nih.gov/books/NBK204/','scope','Calculated globulin fraction'))),
  'NCBI Bookshelf; CLSI EP28'),
 ('THYROID_PROFILE','Thyroid Function Profile','{Thyroid,T3,T4,TSH,T3 T4 TSH}'::text[],'Endocrinology',
  jsonb_build_object('specimen','Serum','method','Validated immunoassay platform; method-specific assay generation and interference review','patient_preparation',jsonb_build_object('medications','Record thyroid medication and high-dose biotin/supplement use where clinically relevant'),'reporting_notes','Do not transfer reference intervals across assay platforms. Interpret TSH and thyroid hormones with pregnancy, age and method-specific context.','source_references',jsonb_build_array(jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals','organization','CLSI','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/','scope','Method-specific reference intervals'))),
  'CLSI EP28; assay manufacturer instructions'),
 ('IRON_PROFILE','Iron Status Profile','{Iron Profile,Iron Studies,TIBC,Transferrin Saturation}'::text[],'Clinical Chemistry',
  jsonb_build_object('specimen','Serum','method','Validated iron and iron-binding capacity assays','patient_preparation',jsonb_build_object('timing','Prefer morning collection where required by local method; document iron supplementation'),'reporting_notes','Transferrin saturation (%) = 100 × serum iron / TIBC. Iron and TIBC must use the same concentration units. Do not apply generic TIBC or ferritin ranges across methods.','source_references',jsonb_build_array(jsonb_build_object('id','ICH-HARM-TSAT','title','International Consortium for Harmonization of Clinical Laboratory Results — Measurands: Transferrin saturation','organization','ICHCLR','url','https://harmonization.net/measurands/','scope','Formula and analytical caveats for transferrin saturation'))),
  'International Consortium for Harmonization of Clinical Laboratory Results'),
 ('COAG_PROFILE','Coagulation Profile','{Coagulation Screen,PT PTT Fibrinogen}'::text[],'Hematology / Coagulation',
  jsonb_build_object('specimen','3.2% sodium citrate plasma; correct fill ratio required','method','Validated coagulation analyzer and reagent-specific clotting assays','collection_requirements',jsonb_build_object('tube','Sodium citrate 3.2%','fill','Maintain correct blood-to-anticoagulant ratio; adjust citrate for high hematocrit according to SOP'),'specimen_requirements',jsonb_build_object('reject','Clotted sample, underfilled tube outside validated acceptance, wrong tube, delayed processing beyond validated limit'),'reporting_notes','INR calculation is reagent ISI and local mean normal PT dependent; this profile records INR as a measured/calculated analyzer output, not a generic formula. D-dimer units and FEU/DDU must be explicit.','source_references',jsonb_build_array(jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals','organization','CLSI','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/','scope','Method-specific reference intervals'))),
  'CLSI EP28; reagent manufacturer instructions')
) as x(code,name,aliases,category,definition,sources)
where r.version='taiba-core-2026.11.20-r1'
on conflict(release_id,master_code) do nothing;

with t as (
 select id,master_code from public.master_catalog_tests
 where release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
), p as (
 select * from (values
 ('KIDNEY_PROFILE','UREA','Urea','mg/dL','numeric',2,'Renal markers',10,'manual',null::jsonb,true),
 ('KIDNEY_PROFILE','BUN','Blood urea nitrogen','mg/dL','numeric',2,'Renal markers',20,'manual',null::jsonb,false),
 ('KIDNEY_PROFILE','CREATININE','Creatinine','mg/dL','numeric',2,'Renal markers',30,'manual',null::jsonb,true),
 ('KIDNEY_PROFILE','URIC_ACID','Uric acid','mg/dL','numeric',2,'Renal markers',40,'manual',null::jsonb,true),
 ('KIDNEY_PROFILE','SODIUM','Sodium','mmol/L','numeric',1,'Electrolytes',50,'manual',null::jsonb,false),
 ('KIDNEY_PROFILE','POTASSIUM','Potassium','mmol/L','numeric',1,'Electrolytes',60,'manual',null::jsonb,false),
 ('KIDNEY_PROFILE','CHLORIDE','Chloride','mmol/L','numeric',1,'Electrolytes',70,'manual',null::jsonb,false),
 ('KIDNEY_PROFILE','EGFR','Estimated GFR (lab-validated equation)','mL/min/1.73 m²','numeric',1,'Renal estimation',80,'manual',null::jsonb,false),
 ('LIVER_PROFILE','ALT','ALT (GPT)','U/L','numeric',0,'Liver enzymes',10,'manual',null::jsonb,true),
 ('LIVER_PROFILE','AST','AST (GOT)','U/L','numeric',0,'Liver enzymes',20,'manual',null::jsonb,true),
 ('LIVER_PROFILE','ALP','Alkaline phosphatase','U/L','numeric',0,'Liver enzymes',30,'manual',null::jsonb,true),
 ('LIVER_PROFILE','GGT','Gamma-glutamyl transferase','U/L','numeric',0,'Liver enzymes',40,'manual',null::jsonb,false),
 ('LIVER_PROFILE','BILIRUBIN_TOTAL','Total bilirubin','mg/dL','numeric',2,'Bilirubin',50,'manual',null::jsonb,true),
 ('LIVER_PROFILE','BILIRUBIN_DIRECT','Direct bilirubin','mg/dL','numeric',2,'Bilirubin',60,'manual',null::jsonb,true),
 ('LIVER_PROFILE','ALBUMIN','Albumin','g/dL','numeric',2,'Protein',70,'manual',null::jsonb,true),
 ('LIVER_PROFILE','TOTAL_PROTEIN','Total protein','g/dL','numeric',2,'Protein',80,'manual',null::jsonb,false),
 ('LIVER_PROFILE','GLOBULIN','Calculated globulin','g/dL','numeric',2,'Calculated',90,'calculated','{"op":"subtract","args":[{"param":"TOTAL_PROTEIN"},{"param":"ALBUMIN"}]}'::jsonb,false),
 ('LIVER_PROFILE','AG_RATIO','Albumin / Globulin ratio','ratio','numeric',2,'Calculated',100,'calculated','{"op":"divide","args":[{"param":"ALBUMIN"},{"param":"GLOBULIN"}]}'::jsonb,false),
 ('THYROID_PROFILE','TSH','Thyroid stimulating hormone','mIU/L','numeric',2,'Thyroid hormones',10,'manual',null::jsonb,true),
 ('THYROID_PROFILE','T3_TOTAL','Total T3','ng/mL','numeric',2,'Thyroid hormones',20,'manual',null::jsonb,false),
 ('THYROID_PROFILE','T4_TOTAL','Total T4','µg/dL','numeric',2,'Thyroid hormones',30,'manual',null::jsonb,false),
 ('THYROID_PROFILE','FT3','Free T3','pg/mL','numeric',2,'Thyroid hormones',40,'manual',null::jsonb,false),
 ('THYROID_PROFILE','FT4','Free T4','ng/dL','numeric',2,'Thyroid hormones',50,'manual',null::jsonb,false),
 ('IRON_PROFILE','IRON','Serum iron','µg/dL','numeric',0,'Iron studies',10,'manual',null::jsonb,true),
 ('IRON_PROFILE','TIBC','Total iron binding capacity','µg/dL','numeric',0,'Iron studies',20,'manual',null::jsonb,true),
 ('IRON_PROFILE','FERRITIN','Ferritin','ng/mL','numeric',1,'Iron studies',30,'manual',null::jsonb,false),
 ('IRON_PROFILE','TRANSFERRIN','Transferrin','mg/dL','numeric',0,'Iron studies',40,'manual',null::jsonb,false),
 ('IRON_PROFILE','TRANSFERRIN_SAT','Transferrin saturation','%','numeric',1,'Calculated',50,'calculated','{"op":"multiply","args":[{"op":"divide","args":[{"param":"IRON"},{"param":"TIBC"}]},{"const":100}]}'::jsonb,true),
 ('COAG_PROFILE','PT','Prothrombin time','seconds','numeric',1,'Coagulation',10,'manual',null::jsonb,true),
 ('COAG_PROFILE','INR','International normalized ratio','ratio','numeric',2,'Coagulation',20,'manual',null::jsonb,true),
 ('COAG_PROFILE','APTT','Activated partial thromboplastin time','seconds','numeric',1,'Coagulation',30,'manual',null::jsonb,true),
 ('COAG_PROFILE','FIBRINOGEN','Fibrinogen','mg/dL','numeric',0,'Coagulation',40,'manual',null::jsonb,false),
 ('COAG_PROFILE','D_DIMER','D-dimer','ng/mL FEU','numeric',0,'Coagulation',50,'manual',null::jsonb,false)
 ) as v(test_code,parameter_code,parameter_name,unit,value_type,decimal_places,section,display_order,result_source,formula,is_required)
)
insert into public.master_catalog_parameters(master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,reference_ranges,choices,display_order,is_required,result_source,formula,clinical_metadata,source_references,clinical_review_status,reference_interval_status)
select t.id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,'[]'::jsonb,'[]'::jsonb,p.display_order,p.is_required,p.result_source,p.formula,
 jsonb_build_object('section',p.section,'group',p.section),
 case when t.master_code='IRON_PROFILE' then jsonb_build_array(jsonb_build_object('id','ICH-HARM-TSAT','title','Transferrin saturation formula','url','https://harmonization.net/measurands/'))
 when t.master_code='KIDNEY_PROFILE' then jsonb_build_array(jsonb_build_object('id','NIDDK-EGFR-2021','title','eGFR Equations for Adults','url','https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/adults'))
 else jsonb_build_array(jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals','url','https://clsi.org/shop/standards/ep28/'))
 end,
 'verified','local_verification_required'
from t join p on p.test_code=t.master_code
on conflict(master_test_id,parameter_code) do nothing;
