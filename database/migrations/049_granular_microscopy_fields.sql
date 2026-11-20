-- Granular morphology and microscopy fields for the three priority manual microscopy profiles.
with t as (
 select id,master_code from public.master_catalog_tests
 where release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
), p as (
 select * from (values
 ('HEM_CBC','RBC_ANISOCYTOSIS','Anisocytosis','choice','RBC morphology',500,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_POIKILOCYTOSIS','Poikilocytosis','choice','RBC morphology',510,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_MICROCYTOSIS','Microcytosis','choice','RBC morphology',520,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_MACROCYTOSIS','Macrocytosis','choice','RBC morphology',530,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_HYPOCHROMIA','Hypochromia','choice','RBC morphology',540,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_POLYCHROMASIA','Polychromasia','choice','RBC morphology',550,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','RBC_TARGET_CELLS','Target cells','choice','RBC morphology',560,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('HEM_CBC','RBC_SCHISTOCYTES','Schistocytes','choice','RBC morphology',570,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('HEM_CBC','RBC_SPHEROCYTES','Spherocytes','choice','RBC morphology',580,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('HEM_CBC','RBC_ELLIPTOCYTES','Elliptocytes / ovalocytes','choice','RBC morphology',590,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('HEM_CBC','RBC_SICKLE_CELLS','Sickle cells','choice','RBC morphology',600,'["Not seen","Seen"]'::jsonb),
 ('HEM_CBC','WBC_LEFT_SHIFT','Left shift','choice','WBC morphology',610,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','WBC_TOXIC_GRANULATION','Toxic granulation','choice','WBC morphology',620,'["Not seen","Mild","Moderate","Marked"]'::jsonb),
 ('HEM_CBC','WBC_ATYPICAL_LYMPHOCYTES','Atypical lymphocytes','choice','WBC morphology',630,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('HEM_CBC','WBC_BLASTS','Blasts','choice','WBC morphology',640,'["Not seen","Seen"]'::jsonb),
 ('HEM_CBC','WBC_HYPERSEGMENTED_NEUTROPHILS','Hypersegmented neutrophils','choice','WBC morphology',650,'["Not seen","Seen"]'::jsonb),
 ('HEM_CBC','PLT_CLUMPING','Platelet clumping','choice','Platelet morphology',660,'["Not seen","Seen"]'::jsonb),
 ('HEM_CBC','PLT_GIANT','Giant platelets','choice','Platelet morphology',670,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('UA_COMPLETE','UA_ODOR','Odor','text','Physical',45,'[]'::jsonb),
 ('UA_COMPLETE','UA_ASCORBIC_ACID','Ascorbic acid','choice','Chemical strip',180,'["Negative","Trace","1+","2+","3+"]'::jsonb),
 ('UA_COMPLETE','UA_WBC_CLUMPS','WBC clumps','choice','Microscopy',370,'["Not seen","Seen"]'::jsonb),
 ('UA_COMPLETE','UA_DYSMORPHIC_RBC','Dysmorphic RBC','choice','Microscopy',380,'["Not assessed","Not seen","Seen"]'::jsonb),
 ('UA_COMPLETE','UA_FATTY_CASTS','Fatty casts','numeric','Microscopy',390,'[]'::jsonb),
 ('UA_COMPLETE','UA_BROAD_CASTS','Broad casts','numeric','Microscopy',400,'[]'::jsonb),
 ('UA_COMPLETE','UA_CYSTINE_CRYSTALS','Cystine crystals','choice','Microscopy',410,'["Not seen","Seen"]'::jsonb),
 ('UA_COMPLETE','UA_AMORPHOUS_CRYSTALS','Amorphous crystals','text','Microscopy',420,'[]'::jsonb),
 ('STOOL_EXAM','ST_PARASITE_METHOD','Parasitology method','choice','Microscopy methods',230,'["Direct saline wet mount","Direct iodine wet mount","Concentration","Permanent stain","Other"]'::jsonb),
 ('STOOL_EXAM','ST_PARASITE_STAGE','Parasite stage identified','choice','Microscopy methods',240,'["Not seen","Cyst","Trophozoite","Ova","Larva","Adult worm / segment","Other"]'::jsonb),
 ('STOOL_EXAM','ST_PARASITE_NAME','Parasite identification','text','Microscopy methods',250,'[]'::jsonb),
 ('STOOL_EXAM','ST_VEGETABLE_CELLS','Vegetable cells / fibers','choice','Microscopy',260,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_UNDIGESTED_FOOD','Undigested food particles','choice','Microscopy',270,'["Not seen","Few","Moderate","Many"]'::jsonb),
 ('STOOL_EXAM','ST_PH','Stool pH','pH','numeric',1,'Chemical / additional',280,'[]'::jsonb)
 ) as v(test_code,parameter_code,parameter_name,value_type,section,display_order,choices)
)
insert into public.master_catalog_parameters(
 master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,reference_ranges,choices,
 display_order,is_required,result_source,formula,clinical_metadata,source_references,clinical_review_status,reference_interval_status
)
select t.id,p.parameter_code,p.parameter_name,
 case when p.parameter_code='ST_PH' then 'pH' when p.value_type='numeric' then '/LPF' else null end,
 p.value_type,case when p.value_type='numeric' then 1 else 0 end,'[]'::jsonb,p.choices,
 p.display_order,false,'manual',null,
 jsonb_build_object('section',p.section,'group',p.section),
 case when t.master_code='HEM_CBC' then jsonb_build_array(jsonb_build_object('id','ICSH-PBS-2015','title','ICSH Recommendations for Standardization of Nomenclature and Grading of Peripheral Blood Cell Morphological Features','year',2015,'doi','10.1111/ijlh.12327','url','https://www.icsh.org/recommendations-for-standardization-of-nomenclature-and-grading-of-peripheral-blood-cell'))
 when t.master_code='UA_COMPLETE' then jsonb_build_array(jsonb_build_object('id','EFLM-UA-2023','title','The EFLM European Urinalysis Guideline 2023','doi','10.1515/cclm-2024-0070','url','https://pubmed.ncbi.nlm.nih.gov/38534005/'))
 else jsonb_build_array(jsonb_build_object('id','WHO-PARASITOLOGY','title','Basic Laboratory Methods in Medical Parasitology','url','https://iris.who.int/bitstream/handle/10665/40793/9241544104_%28part1%29.pdf?isAllowed=y&sequence=1'),jsonb_build_object('id','MAYO-OPE-619736','title','Ova and Parasite, Travel History or Immunocompromised, Feces','url','https://www.mayocliniclabs.com/test-catalog/overview/619736'))
 end,
 'verified','not_applicable'
from t join p on p.test_code=t.master_code
on conflict(master_test_id,parameter_code) do nothing;
