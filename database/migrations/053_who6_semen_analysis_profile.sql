-- WHO 6th edition semen analysis profile; lower fifth-centile limits are source suggestions, not local decision cutoffs.
insert into public.master_catalog_tests(release_id,master_code,canonical_name,alternate_names,test_kind,category,service_type,definition,clinical_review_status,source_name)
select r.id,'SEMEN_ANALYSIS','Semen Analysis — WHO 6th Edition','{semen an,Semen CASA,Semen Examination,تحليل سائل منوي}'::text[],
 'panel','Andrology / Semen Analysis','panel',
 jsonb_build_object(
  'specimen','Complete ejaculate collected by masturbation into a clean, wide-mouth, non-toxic container',
  'method','WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021); manual microscopy and/or validated CASA. Record method for each result.',
  'patient_preparation',jsonb_build_object('abstinence_days','2–7 days; record exact duration','collection','Avoid ordinary condoms and lubricants unless validated non-toxic collection devices are used.'),
  'collection_requirements',jsonb_build_object('complete_sample_required',true,'record','Collection start/end time, abstinence duration, completeness, collection location, and any lost fraction.'),
  'specimen_requirements',jsonb_build_object('container','Clean, wide-mouth, non-toxic semen container','temperature','Protect from temperature extremes; maintain near ambient/body temperature according to WHO manual and local SOP.'),
  'transport_requirements',jsonb_build_object('note','Deliver promptly; begin examination within 60 minutes of ejaculation. Record collection and analysis times.'),
  'stability_requirements',jsonb_build_object('note','Time-sensitive motility assessment; delayed analysis invalidates some parameters. Follow WHO 6th edition and local validation.'),
  'rejection_criteria',jsonb_build_array('Incomplete sample without documentation','Unlabeled or leaking container','Use of unsuitable lubricant/container','Excessive delay or temperature excursion affecting motility'),
  'reporting_notes','Report abstinence duration, collection completeness, time to analysis, method (manual/CASA), volume, concentration, total sperm number, progressive/non-progressive/total motility, vitality, strict morphology, and relevant ancillary findings. WHO lower fifth-centile values are not binary fertile/infertile cutoffs; interpret in clinical context.',
  'source_references',jsonb_build_array(
   jsonb_build_object('id','WHO-SEmen-6E-2021','title','WHO Laboratory Manual for the Examination and Processing of Human Semen, Sixth Edition','organization','World Health Organization','year',2021,'url','https://www.who.int/publications/i/item/9789240030787','scope','Collection, examination, processing, quality control and reference distributions'),
   jsonb_build_object('id','AUA-ASRM-MALE-INFERTILITY-2024','title','Diagnosis and Treatment of Infertility in Men: AUA/ASRM Guideline','organization','AUA/ASRM','year',2024,'url','https://www.auanet.org/documents/Guidelines/PDF/2024%20Guidelines/Male%20Infertility%20Unabridged%20Final.pdf','scope','WHO 6th edition lower fifth-centile values and clinical interpretation'),
   jsonb_build_object('id','WHO-SEmen-6E-REVIEW','title','The Sixth Edition of the WHO Manual for Human Semen Analysis: A Critical Review','year',2021,'doi','10.3390/biology10111149','url','https://pmc.ncbi.nlm.nih.gov/articles/PMC8706130/','scope','WHO 2021 lower fifth centiles and method updates')
  )
 ),'verified','WHO 6th edition 2021; AUA/ASRM 2024'
from public.master_catalog_releases r where r.version='taiba-core-2026.11.20-r1'
on conflict(release_id,master_code) do nothing;

with t as (
 select id from public.master_catalog_tests where master_code='SEMEN_ANALYSIS'
 and release_id=(select id from public.master_catalog_releases where version='taiba-core-2026.11.20-r1')
), p as (
 select * from (values
 ('ABSTINENCE_DAYS','Abstinence duration','days','numeric',1,'Pre-analytical',10,'[]'::jsonb,true,'manual',null::jsonb,null::jsonb),
 ('SEMEN_VOLUME','Semen volume','mL','numeric',2,'Macroscopic',20,'[]'::jsonb,true,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":1.4,"source":"WHO 6th edition / AUA-ASRM 2024","source_url":"https://www.auanet.org/documents/Guidelines/PDF/2024%20Guidelines/Male%20Infertility%20Unabridged%20Final.pdf"}]'::jsonb),
 ('SEMEN_APPEARANCE','Appearance','', 'text',0,'Macroscopic',30,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SEMEN_LIQUEFACTION','Liquefaction time','minutes','numeric',0,'Macroscopic',40,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SEMEN_VISCOSITY','Viscosity','', 'choice',0,'Macroscopic',50,'["Normal","Increased","Reduced"]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SEMEN_PH','pH','pH','numeric',1,'Macroscopic',60,'[]'::jsonb,false,'manual',null::jsonb,'[{"population":"WHO 6th edition method-specific guidance","lower":7.2,"source":"WHO 6th edition"}]'::jsonb),
 ('SPERM_CONCENTRATION','Sperm concentration','million/mL','numeric',1,'Sperm count',100,'[]'::jsonb,true,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":16,"source":"WHO 6th edition / AUA-ASRM 2024","source_url":"https://www.auanet.org/documents/Guidelines/PDF/2024%20Guidelines/Male%20Infertility%20Unabridged%20Final.pdf"}]'::jsonb),
 ('TOTAL_SPERM_NUMBER','Total sperm number per ejaculate','million/ejaculate','numeric',1,'Sperm count',110,'[]'::jsonb,true,'calculated','{"op":"multiply","args":[{"param":"SEMEN_VOLUME"},{"param":"SPERM_CONCENTRATION"}]}'::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":39,"source":"WHO 6th edition / AUA-ASRM 2024","source_url":"https://www.auanet.org/documents/Guidelines/PDF/2024%20Guidelines/Male%20Infertility%20Unabridged%20Final.pdf"}]'::jsonb),
 ('PROGRESSIVE_MOTILITY','Progressive motility','%','numeric',1,'Motility',200,'[]'::jsonb,true,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":30,"source":"WHO 6th edition / AUA-ASRM 2024"}]'::jsonb),
 ('NON_PROGRESSIVE_MOTILITY','Non-progressive motility','%','numeric',1,'Motility',210,'[]'::jsonb,false,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":1,"source":"WHO 6th edition"}]'::jsonb),
 ('TOTAL_MOTILITY','Total motility','%','numeric',1,'Motility',220,'[]'::jsonb,true,'calculated','{"op":"add","args":[{"param":"PROGRESSIVE_MOTILITY"},{"param":"NON_PROGRESSIVE_MOTILITY"}]}'::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":42,"source":"WHO 6th edition / AUA-ASRM 2024"}]'::jsonb),
 ('IMMOTILE_MOTILITY','Immotile sperm','%','numeric',1,'Motility',230,'[]'::jsonb,false,'calculated','{"op":"subtract","args":[{"const":100},{"param":"TOTAL_MOTILITY"}]}'::jsonb,'[{"population":"WHO 2021 fertile reference distribution","upper":20,"source":"WHO 6th edition"}]'::jsonb),
 ('SPERM_VITALITY','Vitality (live spermatozoa)','%','numeric',1,'Vitality',300,'[]'::jsonb,false,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":54,"source":"WHO 6th edition / AUA-ASRM 2024"}]'::jsonb),
 ('NORMAL_MORPHOLOGY','Normal forms (strict morphology)','%','numeric',1,'Morphology',310,'[]'::jsonb,false,'manual',null::jsonb,'[{"population":"WHO 2021 fertile reference distribution","lower":4,"source":"WHO 6th edition / AUA-ASRM 2024"}]'::jsonb),
 ('ROUND_CELLS','Round cells','million/mL','numeric',2,'Additional findings',400,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('PER0XIDASE_LEUKOCYTES','Peroxidase-positive leukocytes','million/mL','numeric',2,'Additional findings',410,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SPERM_AGGLUTINATION','Agglutination','', 'choice',0,'Additional findings',420,'["Not seen","Seen"]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SEMEN_MORPHOLOGY_COMMENT','Morphology / microscopy comment','', 'text',0,'Additional findings',430,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb),
 ('SEMEN_REPORT_COMMENT','Final report comment','', 'text',0,'Additional findings',440,'[]'::jsonb,false,'manual',null::jsonb,'[]'::jsonb)
 ) as v(code,name,unit,value_type,decimal_places,section,display_order,choices,is_required,result_source,formula,reference_ranges)
)
insert into public.master_catalog_parameters(master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,reference_ranges,choices,display_order,is_required,result_source,formula,clinical_metadata,source_references,clinical_review_status,reference_interval_status)
select t.id,p.code,p.name,p.unit,p.value_type,p.decimal_places,p.reference_ranges,p.choices,p.display_order,p.is_required,p.result_source,p.formula,
 jsonb_build_object('section',p.section,'group',p.section,'method_note','Follow WHO 6th edition; method-specific local validation required.'),
 jsonb_build_array(jsonb_build_object('id','WHO-SEmen-6E-2021','title','WHO Laboratory Manual for the Examination and Processing of Human Semen, Sixth Edition','year',2021,'url','https://www.who.int/publications/i/item/9789240030787'),jsonb_build_object('id','AUA-ASRM-MALE-INFERTILITY-2024','title','AUA/ASRM Male Infertility Guideline','year',2024,'url','https://www.auanet.org/documents/Guidelines/PDF/2024%20Guidelines/Male%20Infertility%20Unabridged%20Final.pdf')),
 'verified',case when p.value_type='numeric' then 'local_verification_required' else 'not_applicable' end
from t cross join p
on conflict(master_test_id,parameter_code) do nothing;
