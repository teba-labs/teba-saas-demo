-- Core verified profiles: CBC, complete urinalysis, stool examination, urine culture, stool culture.
-- Numeric reference intervals remain explicitly local-method dependent; no generic ranges are fabricated.
alter table public.master_catalog_parameters
  add column if not exists reference_interval_status text not null default 'local_verification_required'
    check (reference_interval_status in ('not_applicable','local_verification_required','verified_local'));
alter table public.test_parameters
  add column if not exists reference_interval_status text not null default 'local_verification_required'
    check (reference_interval_status in ('not_applicable','local_verification_required','verified_local'));

insert into public.master_catalog_releases(version,title,description,status,published_at)
values(
 'taiba-core-2026.11.20-r1',
 'Taiba Core Laboratory Profiles — Release 1',
 'Core CBC, urinalysis, stool microscopy, urine culture, and stool culture structures. Numeric reference intervals require local analyzer/method verification.',
 'published',now()
) on conflict(version) do nothing;

insert into public.master_catalog_tests(
 release_id,master_code,canonical_name,alternate_names,test_kind,category,service_type,definition,
 clinical_review_status,source_name
)
select r.id,x.code,x.name,x.aliases,x.kind,x.category,x.service_type,x.definition,'verified',x.source_name
from public.master_catalog_releases r
cross join (values
 ('HEM_CBC','Complete Blood Count (CBC)','{CBC,Complete Blood Count,صورة دم كاملة}'::text[],'panel','Hematology','panel',
  jsonb_build_object('specimen','EDTA whole blood','method','Validated hematology analyzer; reflex peripheral smear review when indicated by analyzer flags, clinical request, or laboratory SOP','patient_preparation',jsonb_build_object('fasting_required',false),'collection_requirements',jsonb_build_object('tube','EDTA K2/K3','mixing','Gentle inversion according to tube manufacturer','clot_check_required',true),'specimen_requirements',jsonb_build_object('acceptable','Fresh, well-mixed EDTA whole blood; no clots','reject','Clotted, mislabeled, insufficient, or unsuitable specimens according to local SOP'),'transport_requirements',jsonb_build_object('temperature','Follow analyzer and tube manufacturer validated limits','avoid','Excessive heat, freezing, prolonged storage, and vigorous agitation'),'stability_requirements',jsonb_build_object('note','Set analyzer-specific validated time limits locally; prepare smear within the laboratory validated window'),'rejection_criteria',jsonb_build_array('Clotted specimen','Incorrect tube or underfilled tube where it invalidates the method','Mislabeled or leaking specimen'),'reporting_notes','Report analyzer method and units; review flags and delta checks; morphology comments use standardized ICSH terminology. Numeric reference intervals and analyzer flags require local verification.','source_references',jsonb_build_array(jsonb_build_object('id','ICSH-PBS-2015','title','ICSH Recommendations for Standardization of Nomenclature and Grading of Peripheral Blood Cell Morphological Features','organization','International Council for Standardization in Haematology','year',2015,'doi','10.1111/ijlh.12327','url','https://www.icsh.org/recommendations-for-standardization-of-nomenclature-and-grading-of-peripheral-blood-cell','scope','Peripheral smear morphology terminology and grading'),jsonb_build_object('id','ICSH-ANALYZER-2014','title','ICSH Guidelines for the Evaluation of Blood Cell Analysers','organization','ICSH','year',2014,'doi','10.1111/ijlh.12201','url','https://www.icsh.org/publications','scope','Analyzer evaluation and method performance'),jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory','organization','CLSI','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/','scope','Establishing and verifying method-specific reference intervals'))),
  'ICSH; CLSI EP28'),
 ('UA_COMPLETE','Complete Urinalysis','{Urine Analysis,Urinalysis,تحليل بول كامل}'::text[],'panel','Clinical Pathology','panel',
  jsonb_build_object('specimen','Fresh clean-catch midstream urine unless another collection method is specified','method','Macroscopic examination, reagent strip chemistry, and standardized microscopy/particle analysis','patient_preparation',jsonb_build_object('collection','Clean-catch midstream where appropriate','timing','First morning specimen may improve concentration; record actual collection time'),'collection_requirements',jsonb_build_object('container','Clean, dry, leak-proof container','volume_ml','10-20 mL preferred where available','record','Collection method and time'),'specimen_requirements',jsonb_build_object('acceptable','Fresh urine; document catheter, suprapubic, bag, or other collection method','avoid','Contamination with stool, menstrual blood, disinfectants, or cleaning agents'),'transport_requirements',jsonb_build_object('note','Analyze promptly; if delayed, use validated refrigeration/preservative and document delay and storage conditions'),'stability_requirements',jsonb_build_object('note','Follow EFLM 2023 and local validated limits for dipstick and formed particles; report preanalytical delay when relevant'),'rejection_criteria',jsonb_build_array('Unlabeled or leaking container','Gross contamination','Unacceptable delay or storage outside validated conditions'),'reporting_notes','Separate physical, chemical-strip, and microscopic findings. Report microscopy method and units (e.g. per HPF or standardized quantitative units). Do not mix sediment counts per HPF with automated particles per volume.','source_references',jsonb_build_array(jsonb_build_object('id','EFLM-UA-2023','title','The EFLM European Urinalysis Guideline 2023','organization','EFLM','year',2024,'doi','10.1515/cclm-2024-0070','url','https://pubmed.ncbi.nlm.nih.gov/38534005/','scope','Patient preparation, specimen collection/preservation, chemistry, urine particles, microscopy, bacteriology'),jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory','organization','CLSI','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/','scope','Local reference interval verification'))),
  'EFLM European Urinalysis Guideline 2023'),
 ('STOOL_EXAM','Complete Stool Examination','{Stool Analysis,Stool Examination,تحليل براز كامل}'::text[],'panel','Parasitology','panel',
  jsonb_build_object('specimen','Fresh stool in a clean, dry, leak-proof container; separate preservative container only when method requires','method','Macroscopic examination and direct wet mount; concentration and permanent stain according to clinical request and laboratory SOP','patient_preparation',jsonb_build_object('avoid','Urine, water, soil, toilet disinfectant, and contamination with other materials'),'collection_requirements',jsonb_build_object('container','Wide-mouth clean dry container','record','Collection date/time, consistency, recent antiparasitic therapy if supplied'),'specimen_requirements',jsonb_build_object('freshness','Fresh liquid stool should be examined promptly for motile trophozoites; preserve aliquots according to validated parasitology SOP'),'transport_requirements',jsonb_build_object('note','Use appropriate fixative/transport system when immediate examination is not possible; preserve separate unfixed aliquot if additional testing is required'),'stability_requirements',jsonb_build_object('note','Method- and preservative-specific; no single stability period applies to all parasite stages and procedures'),'rejection_criteria',jsonb_build_array('Unlabeled/leaking container','Specimen contaminated with urine or disinfectant','Incorrect preservative for requested method'),'reporting_notes','Report the actual method performed (direct wet mount, concentration, permanent stain). Do not report a negative direct wet mount as excluding all parasitic infection. Identify organisms to the level supported by morphology and method.','source_references',jsonb_build_array(jsonb_build_object('id','WHO-PARASITOLOGY','title','Basic Laboratory Methods in Medical Parasitology','organization','World Health Organization','url','https://iris.who.int/bitstream/handle/10665/40793/9241544104_%28part1%29.pdf?isAllowed=y&sequence=1','scope','Specimen collection, direct wet mount, concentration, parasite stages and microscopy'),jsonb_build_object('id','ASM-MCM-PARASITOLOGY-2023','title','Manual of Clinical Microbiology: Specimen Collection, Transport, and Processing — Parasitology','organization','ASM/Wiley','year',2023,'doi','10.1002/9781683670438.mcm0137','url','https://onlinelibrary.wiley.com/doi/10.1002/9781683670438.mcm0137','scope','Parasitology specimen processing'))),
  'WHO Basic Laboratory Methods in Medical Parasitology; ASM Manual of Clinical Microbiology'),
 ('CULTURE_URINE','Urine Culture and Antimicrobial Susceptibility','{Urine C/S,Urine Culture,مزرعة بول}'::text[],'panel','Clinical Microbiology','panel',
  jsonb_build_object('specimen','Urine collected by documented method: midstream, catheter, suprapubic aspiration, or other','method','Quantitative culture using validated calibrated loop/automated inoculation and organism identification; AST only when indicated and validated','patient_preparation',jsonb_build_object('antibiotics','Record current/recent antimicrobial therapy if known'),'collection_requirements',jsonb_build_object('container','Sterile leak-proof container or validated preservative tube','record','Collection method and time are mandatory metadata'),'specimen_requirements',jsonb_build_object('volume_ml','Use validated minimum volume for the method; document collection method'),'transport_requirements',jsonb_build_object('room_temperature','Do not leave at room temperature beyond 30 minutes; refrigerate or use validated preservative if processing is delayed'),'stability_requirements',jsonb_build_object('note','Follow EFLM/IDSA-ASM specimen-specific preservation and local validation'),'rejection_criteria',jsonb_build_array('Unlabeled/leaking specimen','Unacceptable delay at room temperature','Container/preservative unsuitable for culture'),'reporting_notes','Interpret colony count with collection method, symptoms, pyuria, and number of organisms. Mixed growth may indicate contamination. AST interpretation must use current adopted CLSI/EUCAST standard, organism-specific breakpoints, and validated method. Record isolate-specific AST, not a single shared antibiogram.','source_references',jsonb_build_array(jsonb_build_object('id','IDSA-ASM-2024','title','Guide to Utilization of the Microbiology Laboratory for Diagnosis of Infectious Diseases: 2024 Update','organization','IDSA/ASM','year',2024,'doi','10.1093/cid/ciae104','url','https://academic.oup.com/cid/advance-article/doi/10.1093/cid/ciae104/7619499','scope','Urine culture specimen handling and interpretation'),jsonb_build_object('id','EFLM-UA-2023','title','The EFLM European Urinalysis Guideline 2023','organization','EFLM','year',2024,'doi','10.1515/cclm-2024-0070','url','https://pubmed.ncbi.nlm.nih.gov/38534005/','scope','Urine culture collection and preanalytical quality'),jsonb_build_object('id','CLSI-M100-36','title','Performance Standards for Antimicrobial Susceptibility Testing','organization','CLSI','edition','M100 36th Edition','year',2026,'url','https://clsi.org/shop/standards/m100/','scope','Current organism/drug-specific AST breakpoints; must be used with CLSI M02/M07/M11 methods'))),
  'IDSA/ASM 2024; EFLM 2023; CLSI M100-Ed36'),
 ('CULTURE_STOOL','Stool Culture and Pathogen Identification','{Stool C/S,Stool Culture,مزرعة براز}'::text[],'panel','Clinical Microbiology','panel',
  jsonb_build_object('specimen','Fresh stool in sterile leak-proof container; rectal swab only when accepted by the laboratory method','method','Selective/differential culture and organism identification according to requested pathogen and validated SOP','patient_preparation',jsonb_build_object('antibiotics','Record recent antimicrobial therapy if known'),'collection_requirements',jsonb_build_object('container','Sterile wide-mouth container; Cary-Blair transport medium for accepted swab/transport workflows as validated'),'specimen_requirements',jsonb_build_object('note','Request clinical details and suspected pathogen when indicated; not every enteric pathogen is recovered by routine stool culture'),'transport_requirements',jsonb_build_object('note','Prompt transport; use validated enteric transport medium when delay is expected'),'stability_requirements',jsonb_build_object('note','Pathogen- and transport-medium-specific; follow current laboratory SOP'),'rejection_criteria',jsonb_build_array('Unlabeled/leaking specimen','Specimen contaminated with urine or disinfectant','Unacceptable transport or medium'),'reporting_notes','Report organisms sought/recovered and method limitations. Do not imply a negative routine culture excludes viruses, parasites, toxins, or pathogens not included in the culture protocol. AST only when clinically indicated and validated.','source_references',jsonb_build_array(jsonb_build_object('id','IDSA-ASM-2024','title','Guide to Utilization of the Microbiology Laboratory for Diagnosis of Infectious Diseases: 2024 Update','organization','IDSA/ASM','year',2024,'doi','10.1093/cid/ciae104','url','https://academic.oup.com/cid/advance-article/doi/10.1093/cid/ciae104/7619499','scope','Microbiology test selection, stool culture and specimen guidance'),jsonb_build_object('id','ASM-MCM-PARASITOLOGY-2023','title','Manual of Clinical Microbiology: Specimen Collection, Transport, and Processing — Parasitology','organization','ASM/Wiley','year',2023,'doi','10.1002/9781683670438.mcm0137','url','https://onlinelibrary.wiley.com/doi/10.1002/9781683670438.mcm0137','scope','Stool specimen processing distinctions'))),
  'IDSA/ASM 2024; ASM Manual of Clinical Microbiology')
) as x(code,name,aliases,kind,category,service_type,definition,source_name)
where r.version='taiba-core-2026.11.20-r1'
on conflict(release_id,master_code) do nothing;

-- Result fields. Sections preserve clinically meaningful grouping in the result-entry screen.
with t as (
 select id,master_code from public.master_catalog_tests
 where release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
), p as (
 select * from (values
 -- CBC: analyzer results and differential. No universal numeric ranges are embedded.
 ('HEM_CBC','WBC','White blood cell count','10^9/L','numeric',2,'Counts & indices',10,'[]'::jsonb),
 ('HEM_CBC','RBC','Red blood cell count','10^12/L','numeric',2,'Counts & indices',20,'[]'::jsonb),
 ('HEM_CBC','HGB','Hemoglobin','g/dL','numeric',2,'Counts & indices',30,'[]'::jsonb),
 ('HEM_CBC','HCT','Hematocrit','%','numeric',2,'Counts & indices',40,'[]'::jsonb),
 ('HEM_CBC','MCV','Mean corpuscular volume','fL','numeric',2,'Counts & indices',50,'[]'::jsonb),
 ('HEM_CBC','MCH','Mean corpuscular hemoglobin','pg','numeric',2,'Counts & indices',60,'[]'::jsonb),
 ('HEM_CBC','MCHC','Mean corpuscular hemoglobin concentration','g/dL','numeric',2,'Counts & indices',70,'[]'::jsonb),
 ('HEM_CBC','RDW_CV','Red cell distribution width CV','%','numeric',2,'Counts & indices',80,'[]'::jsonb),
 ('HEM_CBC','RDW_SD','Red cell distribution width SD','fL','numeric',2,'Counts & indices',90,'[]'::jsonb),
 ('HEM_CBC','PLT','Platelet count','10^9/L','numeric',0,'Counts & indices',100,'[]'::jsonb),
 ('HEM_CBC','MPV','Mean platelet volume','fL','numeric',2,'Counts & indices',110,'[]'::jsonb),
 ('HEM_CBC','PDW','Platelet distribution width','fL','numeric',2,'Counts & indices',120,'[]'::jsonb),
 ('HEM_CBC','PCT','Plateletcrit','%','numeric',2,'Counts & indices',130,'[]'::jsonb),
 ('HEM_CBC','NEUT_PCT','Neutrophils %','%','numeric',1,'Differential',200,'[]'::jsonb),
 ('HEM_CBC','LYMPH_PCT','Lymphocytes %','%','numeric',1,'Differential',210,'[]'::jsonb),
 ('HEM_CBC','MONO_PCT','Monocytes %','%','numeric',1,'Differential',220,'[]'::jsonb),
 ('HEM_CBC','EOS_PCT','Eosinophils %','%','numeric',1,'Differential',230,'[]'::jsonb),
 ('HEM_CBC','BASO_PCT','Basophils %','%','numeric',1,'Differential',240,'[]'::jsonb),
 ('HEM_CBC','NEUT_ABS','Absolute neutrophil count','10^9/L','numeric',2,'Differential',250,'[]'::jsonb),
 ('HEM_CBC','LYMPH_ABS','Absolute lymphocyte count','10^9/L','numeric',2,'Differential',260,'[]'::jsonb),
 ('HEM_CBC','MONO_ABS','Absolute monocyte count','10^9/L','numeric',2,'Differential',270,'[]'::jsonb),
 ('HEM_CBC','EOS_ABS','Absolute eosinophil count','10^9/L','numeric',2,'Differential',280,'[]'::jsonb),
 ('HEM_CBC','BASO_ABS','Absolute basophil count','10^9/L','numeric',2,'Differential',290,'[]'::jsonb),
 ('HEM_CBC','NRBC_PCT','Nucleated red blood cells %','/100 WBC','numeric',1,'Differential',300,'[]'::jsonb),
 ('HEM_CBC','RBC_MORPH','RBC morphology','', 'text',0,'Peripheral smear',400,'[]'::jsonb),
 ('HEM_CBC','WBC_MORPH','WBC morphology','', 'text',0,'Peripheral smear',410,'[]'::jsonb),
 ('HEM_CBC','PLT_MORPH','Platelet morphology','', 'text',0,'Peripheral smear',420,'[]'::jsonb),
 ('HEM_CBC','SMEAR_COMMENT','Peripheral smear comment','', 'text',0,'Peripheral smear',430,'[]'::jsonb),
 -- Urinalysis: physical, reagent strip and sediment.
 ('UA_COMPLETE','UA_COLOR','Color','', 'choice',0,'Physical',10,'["Pale yellow","Yellow","Dark yellow","Amber","Red","Brown","Other"]'::jsonb),
 ('UA_COMPLETE','UA_APPEARANCE','Appearance','', 'choice',0,'Physical',20,'["Clear","Slightly cloudy","Cloudy","Turbid"]'::jsonb),
 ('UA_COMPLETE','UA_SPECIFIC_GRAVITY','Specific gravity','', 'numeric',3,'Physical',30,'[]'::jsonb),
 ('UA_COMPLETE','UA_PH','pH','', 'numeric',1,'Physical',40,'[]'::jsonb),
 ('UA_COMPLETE','UA_PROTEIN','Protein','', 'choice',0,'Chemical strip',100,'["Negative","Trace","1+","2+","3+","4+"]'::jsonb),
 ('UA_COMPLETE','UA_GLUCOSE','Glucose','', 'choice',0,'Chemical strip',110,'["Negative","Trace","1+","2+","3+","4+"]'::jsonb),
 ('UA_COMPLETE','UA_KETONE','Ketones','', 'choice',0,'Chemical strip',120,'["Negative","Trace","1+","2+","3+"]'::jsonb),
 ('UA_COMPLETE','UA_BILIRUBIN','Bilirubin','', 'choice',0,'Chemical strip',130,'["Negative","Trace","1+","2+","3+"]'::jsonb),
 ('UA_COMPLETE','UA_UROBILINOGEN','Urobilinogen','', 'text',0,'Chemical strip',140,'[]'::jsonb),
 ('UA_COMPLETE','UA_BLOOD','Blood / hemoglobin','', 'choice',0,'Chemical strip',150,'["Negative","Trace","1+","2+","3+"]'::jsonb),
 ('UA_COMPLETE','UA_NITRITE','Nitrite','', 'choice',0,'Chemical strip',160,'["Negative","Positive"]'::jsonb),
 ('UA_COMPLETE','UA_LE','Leukocyte esterase','', 'choice',0,'Chemical strip',170,'["Negative","Trace","1+","2+","3+"]'::jsonb),
 ('UA_COMPLETE','UA_RBC_HPF','RBC / HPF','/HPF','numeric',0,'Microscopy',200,'[]'::jsonb),
 ('UA_COMPLETE','UA_WBC_HPF','WBC / HPF','/HPF','numeric',0,'Microscopy',210,'[]'::jsonb),
 ('UA_COMPLETE','UA_SQUAMOUS','Squamous epithelial cells','/HPF','numeric',0,'Microscopy',220,'[]'::jsonb),
 ('UA_COMPLETE','UA_TRANSITIONAL','Transitional epithelial cells','/HPF','numeric',0,'Microscopy',230,'[]'::jsonb),
 ('UA_COMPLETE','UA_RENAL_EPITHELIAL','Renal tubular epithelial cells','/HPF','numeric',0,'Microscopy',240,'[]'::jsonb),
 ('UA_COMPLETE','UA_HYALINE_CASTS','Hyaline casts','/LPF','numeric',0,'Microscopy',250,'[]'::jsonb),
 ('UA_COMPLETE','UA_GRANULAR_CASTS','Granular casts','/LPF','numeric',0,'Microscopy',260,'[]'::jsonb),
 ('UA_COMPLETE','UA_WBC_CASTS','WBC casts','/LPF','numeric',0,'Microscopy',270,'[]'::jsonb),
 ('UA_COMPLETE','UA_RBC_CASTS','RBC casts','/LPF','numeric',0,'Microscopy',280,'[]'::jsonb),
 ('UA_COMPLETE','UA_WAXY_CASTS','Waxy casts','/LPF','numeric',0,'Microscopy',290,'[]'::jsonb),
 ('UA_COMPLETE','UA_CRYSTALS','Crystals','', 'text',0,'Microscopy',300,'[]'::jsonb),
 ('UA_COMPLETE','UA_BACTERIA','Bacteria','', 'choice',0,'Microscopy',310,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('UA_COMPLETE','UA_YEAST','Yeast cells','', 'choice',0,'Microscopy',320,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('UA_COMPLETE','UA_MUCUS','Mucus threads','', 'choice',0,'Microscopy',330,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('UA_COMPLETE','UA_TRICHOMONAS','Trichomonas vaginalis','', 'choice',0,'Microscopy',340,'["Not seen","Seen"]'::jsonb),
 ('UA_COMPLETE','UA_SPERM','Spermatozoa','', 'choice',0,'Microscopy',350,'["Not seen","Seen"]'::jsonb),
 ('UA_COMPLETE','UA_SEDIMENT_COMMENT','Urine sediment comment','', 'text',0,'Microscopy',360,'[]'::jsonb),
 -- Stool: gross and microscopic parasitology.
 ('STOOL_EXAM','ST_COLOR','Color','', 'choice',0,'Macroscopic',10,'["Brown","Yellow","Green","Black","Pale","Red","Other"]'::jsonb),
 ('STOOL_EXAM','ST_CONSISTENCY','Consistency','', 'choice',0,'Macroscopic',20,'["Formed","Soft","Semi-formed","Loose","Watery"]'::jsonb),
 ('STOOL_EXAM','ST_MUCOUS','Mucus','', 'choice',0,'Macroscopic',30,'["Absent","Present"]'::jsonb),
 ('STOOL_EXAM','ST_BLOOD','Visible blood','', 'choice',0,'Macroscopic',40,'["Absent","Present"]'::jsonb),
 ('STOOL_EXAM','ST_ADULT_WORMS','Adult worms / segments','', 'text',0,'Macroscopic',50,'[]'::jsonb),
 ('STOOL_EXAM','ST_RBC','RBC','/HPF','numeric',0,'Microscopy',100,'[]'::jsonb),
 ('STOOL_EXAM','ST_WBC','WBC','/HPF','numeric',0,'Microscopy',110,'[]'::jsonb),
 ('STOOL_EXAM','ST_OVA','Helminth ova','', 'text',0,'Microscopy',120,'[]'::jsonb),
 ('STOOL_EXAM','ST_CYSTS','Protozoal cysts','', 'text',0,'Microscopy',130,'[]'::jsonb),
 ('STOOL_EXAM','ST_TROPHOZOITES','Protozoal trophozoites','', 'text',0,'Microscopy',140,'[]'::jsonb),
 ('STOOL_EXAM','ST_LARVAE','Larvae','', 'text',0,'Microscopy',150,'[]'::jsonb),
 ('STOOL_EXAM','ST_FAT','Fat globules','', 'choice',0,'Microscopy',160,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_STARCH','Starch granules','', 'choice',0,'Microscopy',170,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_MUSCLE','Muscle fibers','', 'choice',0,'Microscopy',180,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_YEAST','Yeast cells','', 'choice',0,'Microscopy',190,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_CHARCOT','Charcot-Leyden crystals','', 'choice',0,'Microscopy',200,'["Not seen","Seen"]'::jsonb),
 ('STOOL_EXAM','ST_MACROPHAGES','Macrophages','', 'choice',0,'Microscopy',210,'["Not seen","Seen"]'::jsonb),
 ('STOOL_EXAM','ST_COMMENT','Microscopy comment','', 'text',0,'Microscopy',220,'[]'::jsonb),
 -- Culture summary fields. Isolates and AST are stored in dedicated repeatable tables, not flattened into text.
 ('CULTURE_URINE','CU_GROWTH','Culture growth status','', 'choice',0,'Culture result',10,'["No growth","Growth","Mixed growth / possible contamination","Pending","Not performed"]'::jsonb),
 ('CULTURE_URINE','CU_COLONY_COUNT','Colony count','CFU/mL','numeric',0,'Culture result',20,'[]'::jsonb),
 ('CULTURE_URINE','CU_IDENTIFICATION','Organism identification summary','', 'text',0,'Culture result',30,'[]'::jsonb),
 ('CULTURE_URINE','CU_AST_COMMENT','Antimicrobial susceptibility comment','', 'text',0,'Culture result',40,'[]'::jsonb),
 ('CULTURE_URINE','CU_REPORT_COMMENT','Final culture comment','', 'text',0,'Culture result',50,'[]'::jsonb),
 ('CULTURE_STOOL','CS_GROWTH','Culture growth status','', 'choice',0,'Culture result',10,'["No pathogen isolated","Pathogen isolated","Normal enteric flora","Mixed growth","Pending","Not performed"]'::jsonb),
 ('CULTURE_STOOL','CS_PATHOGEN','Pathogen identification summary','', 'text',0,'Culture result',20,'[]'::jsonb),
 ('CULTURE_STOOL','CS_AST_COMMENT','Antimicrobial susceptibility comment','', 'text',0,'Culture result',30,'[]'::jsonb),
 ('CULTURE_STOOL','CS_REPORT_COMMENT','Final culture comment','', 'text',0,'Culture result',40,'[]'::jsonb)
 ) as v(test_code,parameter_code,parameter_name,unit,value_type,decimal_places,section,display_order,choices)
)
insert into public.master_catalog_parameters(
 master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,reference_ranges,choices,
 display_order,is_required,result_source,formula,clinical_metadata,source_references,
 clinical_review_status,reference_interval_status,alternate_units
)
select t.id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,'[]'::jsonb,p.choices,
 p.display_order,true,'manual',null,
 jsonb_build_object('section',p.section,'group',p.section),
 case
  when t.master_code='HEM_CBC' then jsonb_build_array(jsonb_build_object('id','ICSH-ANALYZER-2014','title','ICSH Guidelines for the Evaluation of Blood Cell Analysers','year',2014,'url','https://www.icsh.org/publications'),jsonb_build_object('id','CLSI-EP28','title','Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory','edition','EP28-A3c','url','https://clsi.org/shop/standards/ep28/'))
  when t.master_code='UA_COMPLETE' then jsonb_build_array(jsonb_build_object('id','EFLM-UA-2023','title','The EFLM European Urinalysis Guideline 2023','doi','10.1515/cclm-2024-0070','url','https://pubmed.ncbi.nlm.nih.gov/38534005/'))
  when t.master_code='STOOL_EXAM' then jsonb_build_array(jsonb_build_object('id','WHO-PARASITOLOGY','title','Basic Laboratory Methods in Medical Parasitology','url','https://iris.who.int/bitstream/handle/10665/40793/9241544104_%28part1%29.pdf?isAllowed=y&sequence=1'))
  else jsonb_build_array(jsonb_build_object('id','IDSA-ASM-2024','title','Guide to Utilization of the Microbiology Laboratory for Diagnosis of Infectious Diseases: 2024 Update','doi','10.1093/cid/ciae104','url','https://academic.oup.com/cid/advance-article/doi/10.1093/cid/ciae104/7619499'),jsonb_build_object('id','CLSI-M100-36','title','Performance Standards for Antimicrobial Susceptibility Testing','edition','M100 36th Edition','year',2026,'url','https://clsi.org/shop/standards/m100/'))
 end,
 'verified',
 case when p.value_type='numeric' then 'local_verification_required' else 'not_applicable' end,
 '[]'::jsonb
from t join p on p.test_code=t.master_code
on conflict(master_test_id,parameter_code) do nothing;

-- Tenant import carries the explicit local-range state and the section metadata.
create or replace function public.import_master_catalog_test(p_tenant_id uuid,p_master_test_id uuid)
returns uuid language plpgsql security invoker
set search_path=pg_catalog,public,private
as $function$
declare
 v_master public.master_catalog_tests%rowtype; v_release public.master_catalog_releases%rowtype;
 v_test_id uuid; v_existing uuid; v_definition jsonb; v_parameters jsonb; v_parameter_count integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the tenant owner may import master catalog tests'; end if;
 select * into v_master from public.master_catalog_tests where id=p_master_test_id;
 if not found then raise exception 'Master catalog test was not found'; end if;
 select * into v_release from public.master_catalog_releases where id=v_master.release_id and status='published';
 if not found then raise exception 'Only tests in a published master release can be imported'; end if;
 select test_id into v_existing from public.tenant_catalog_master_links where tenant_id=p_tenant_id and master_test_id=p_master_test_id;
 if v_existing is not null then return v_existing; end if;
 if exists(select 1 from public.tests_catalog where tenant_id=p_tenant_id and code=v_master.master_code) then
  raise exception 'A tenant test already uses master code %. Rename the existing test before importing.',v_master.master_code;
 end if;
 if not exists(select 1 from public.master_catalog_parameters where master_test_id=p_master_test_id) then
  raise exception 'Master catalog test has no result parameters';
 end if;
 v_definition:=coalesce(v_master.definition,'{}'::jsonb);
 insert into public.tests_catalog(
  tenant_id,code,name,test_kind,category,specimen,method,turnaround_minutes,instructions,is_active,
  short_name,synonyms,loinc_code,clinical_category,clinical_purpose,service_type,
  patient_preparation,collection_requirements,specimen_requirements,transport_requirements,
  stability_requirements,rejection_criteria,biosafety_notes,critical_result_policy,
  reporting_notes,source_references,clinical_review_status,catalog_version
 ) values (
  p_tenant_id,v_master.master_code,v_master.canonical_name,v_master.test_kind,
  coalesce(v_master.category,v_definition->>'category'),v_definition->>'specimen',v_definition->>'method',
  nullif(v_definition->>'turnaround_minutes','')::integer,v_definition->>'instructions',true,
  v_definition->>'short_name',coalesce(v_master.alternate_names,'{}'),v_definition->>'loinc_code',
  v_definition->>'clinical_category',v_definition->>'clinical_purpose',coalesce(v_master.service_type,'laboratory_test'),
  coalesce(v_definition->'patient_preparation','{}'::jsonb),coalesce(v_definition->'collection_requirements','{}'::jsonb),
  coalesce(v_definition->'specimen_requirements','{}'::jsonb),coalesce(v_definition->'transport_requirements','{}'::jsonb),
  coalesce(v_definition->'stability_requirements','{}'::jsonb),
  coalesce(array(select jsonb_array_elements_text(coalesce(v_definition->'rejection_criteria','[]'::jsonb))),'{}'),
  v_definition->>'biosafety_notes',coalesce(v_definition->'critical_result_policy','{}'::jsonb),
  v_definition->>'reporting_notes',coalesce(v_definition->'source_references','[]'::jsonb),
  v_master.clinical_review_status,v_release.version
 ) returning id into v_test_id;

 insert into public.test_parameters(
  tenant_id,test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
  reference_ranges,choices,display_order,is_required,is_active,result_source,formula,
  unit_ucum,alternate_units,critical_ranges,interpretation_rules,applicability,
  method_notes,clinical_metadata,source_references,clinical_review_status,reference_interval_status
 )
 select p_tenant_id,v_test_id,p.parameter_code,p.parameter_name,p.unit,p.value_type,p.decimal_places,
  p.reference_ranges,p.choices,p.display_order,p.is_required,true,'manual',null,
  p.unit_ucum,p.alternate_units,p.critical_ranges,p.interpretation_rules,p.applicability,
  p.clinical_metadata->>'method_notes',p.clinical_metadata,p.source_references,p.clinical_review_status,p.reference_interval_status
 from public.master_catalog_parameters p
 where p.master_test_id=p_master_test_id order by p.display_order,p.parameter_code;
 get diagnostics v_parameter_count=row_count;
 if v_parameter_count=0 then raise exception 'Master catalog test has no result parameters'; end if;
 update public.test_parameters tp set result_source=mp.result_source,formula=mp.formula
 from public.master_catalog_parameters mp
 where tp.tenant_id=p_tenant_id and tp.test_id=v_test_id and mp.master_test_id=p_master_test_id
  and mp.parameter_code=tp.parameter_code and mp.result_source='calculated';
 select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order,p.parameter_code),'[]'::jsonb)
 into v_parameters from public.test_parameters p where p.tenant_id=p_tenant_id and p.test_id=v_test_id;
 insert into public.tenant_catalog_master_links(tenant_id,test_id,master_test_id,imported_release_id,last_applied_version,baseline_snapshot,customization_fields,sync_status)
 values(p_tenant_id,v_test_id,p_master_test_id,v_release.id,v_release.version,
  jsonb_build_object('test',(select to_jsonb(t) from public.tests_catalog t where t.id=v_test_id),'parameters',v_parameters),'{}','current');
 return v_test_id;
end;
$function$;
revoke all on function public.import_master_catalog_test(uuid,uuid) from public,anon;
grant execute on function public.import_master_catalog_test(uuid,uuid) to authenticated;

-- Preserve all clinical metadata and local interval status on every ordered visit snapshot.
create or replace function private.apply_catalog_price_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
declare v_price numeric(12,2); v_code text; v_name text; v_params jsonb; v_category text; v_service text;
begin
 if tg_op='UPDATE' then
  if new.price_snapshot is distinct from old.price_snapshot or new.technical_snapshot is distinct from old.technical_snapshot
   or new.test_code_snapshot is distinct from old.test_code_snapshot or new.test_name_snapshot is distinct from old.test_name_snapshot then
   raise exception 'Visit test price and technical snapshots are immutable';
  end if; return new;
 end if;
 select tc.code,tc.name,tc.clinical_category,tc.service_type into v_code,v_name,v_category,v_service
 from public.tests_catalog tc where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
 if v_code is null then raise exception 'Test is not active in this tenant catalog'; end if;
 select tp.selling_price into v_price from public.test_prices tp where tp.tenant_id=new.tenant_id and tp.test_id=new.test_id and tp.is_current
  and (tp.branch_id=new.branch_id or tp.branch_id is null) order by (tp.branch_id is not null) desc limit 1;
 if v_price is null then raise exception 'No active price configured for this test and branch'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',p.parameter_code,'name',p.parameter_name,'unit',p.unit,'value_type',p.value_type,'decimal_places',p.decimal_places,
  'reference_ranges',p.reference_ranges,'reference_interval_status',p.reference_interval_status,'choices',p.choices,
  'display_order',p.display_order,'is_required',p.is_required,'result_source',p.result_source,'formula',p.formula,
  'clinical_metadata',p.clinical_metadata,'critical_ranges',p.critical_ranges,'interpretation_rules',p.interpretation_rules,
  'applicability',p.applicability,'source_references',p.source_references
 ) order by p.display_order,p.parameter_code),'[]'::jsonb) into v_params
 from public.test_parameters p where p.tenant_id=new.tenant_id and p.test_id=new.test_id and p.is_active;
 if jsonb_array_length(v_params)=0 then raise exception 'Define at least one active parameter before ordering this test'; end if;
 new.price_snapshot:=v_price; new.test_code_snapshot:=v_code; new.test_name_snapshot:=v_name;
 new.technical_snapshot:=jsonb_build_object('parameters',v_params,'clinical_category',v_category,'service_type',v_service);
 return new;
end;
$function$;
