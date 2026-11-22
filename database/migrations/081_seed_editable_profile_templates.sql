-- Add 13 clinically common, editable draft panel templates to bring the master library
-- to 50 profiles. These are NOT clinically approved reference profiles: all parameters
-- intentionally have empty reference ranges and needs_review status for local completion.
with release_row as (
  select id from public.master_catalog_releases
  where version='taiba-core-2026.11.20-r1' and status='published'
),
profiles(master_code,canonical_name,category,parameters) as (
  values
  ('ELECTROLYTE_PROFILE','Electrolyte Profile','Clinical Chemistry',
   '[{"code":"SODIUM","name":"Sodium","unit":"mmol/L","type":"numeric","decimals":1},{"code":"POTASSIUM","name":"Potassium","unit":"mmol/L","type":"numeric","decimals":1},{"code":"CHLORIDE","name":"Chloride","unit":"mmol/L","type":"numeric","decimals":1},{"code":"BICARBONATE","name":"Bicarbonate / Total CO2","unit":"mmol/L","type":"numeric","decimals":1}]'::jsonb),
  ('BONE_PROFILE','Bone Metabolism Profile','Clinical Chemistry',
   '[{"code":"CALCIUM_TOTAL","name":"Calcium, total","unit":"mg/dL","type":"numeric","decimals":2},{"code":"PHOSPHATE","name":"Phosphate","unit":"mg/dL","type":"numeric","decimals":2},{"code":"ALP","name":"Alkaline phosphatase","unit":"U/L","type":"numeric","decimals":0},{"code":"ALBUMIN","name":"Albumin","unit":"g/dL","type":"numeric","decimals":2}]'::jsonb),
  ('CARDIAC_MARKERS_PROFILE','Cardiac Markers Profile','Clinical Chemistry / Cardiology',
   '[{"code":"CK_TOTAL","name":"Creatine kinase, total","unit":"U/L","type":"numeric","decimals":0},{"code":"CK_MB","name":"CK-MB","unit":"","type":"numeric","decimals":2},{"code":"TROPONIN_I","name":"Troponin I","unit":"","type":"numeric","decimals":2},{"code":"LDH","name":"Lactate dehydrogenase","unit":"U/L","type":"numeric","decimals":0}]'::jsonb),
  ('GLYCEMIC_CONTROL_PROFILE','Glycemic Control Profile','Clinical Chemistry / Diabetes',
   '[{"code":"GLUCOSE_FASTING","name":"Fasting plasma glucose","unit":"mg/dL","type":"numeric","decimals":0},{"code":"GLUCOSE_2H_PP","name":"2-hour postprandial glucose","unit":"mg/dL","type":"numeric","decimals":0},{"code":"HBA1C","name":"Hemoglobin A1c","unit":"%","type":"numeric","decimals":1}]'::jsonb),
  ('THYROID_ANTIBODY_PROFILE','Thyroid Autoantibody Profile','Endocrinology / Immunology',
   '[{"code":"ANTI_TPO","name":"Anti-thyroid peroxidase antibody","unit":"IU/mL","type":"numeric","decimals":2},{"code":"ANTI_TG","name":"Anti-thyroglobulin antibody","unit":"IU/mL","type":"numeric","decimals":2},{"code":"TRAB","name":"TSH receptor antibody","unit":"IU/L","type":"numeric","decimals":2}]'::jsonb),
  ('MALE_FERTILITY_HORMONE_PROFILE','Male Fertility Hormone Profile','Endocrinology / Andrology',
   '[{"code":"FSH","name":"Follicle-stimulating hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"LH","name":"Luteinizing hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"TESTOSTERONE_TOTAL","name":"Testosterone, total","unit":"ng/dL","type":"numeric","decimals":2},{"code":"PROLACTIN","name":"Prolactin","unit":"ng/mL","type":"numeric","decimals":2},{"code":"ESTRADIOL","name":"Estradiol","unit":"pg/mL","type":"numeric","decimals":2}]'::jsonb),
  ('FEMALE_CYCLE_HORMONE_PROFILE','Female Cycle Hormone Profile','Endocrinology / Gynecology',
   '[{"code":"FSH","name":"Follicle-stimulating hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"LH","name":"Luteinizing hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"ESTRADIOL","name":"Estradiol","unit":"pg/mL","type":"numeric","decimals":2},{"code":"PROGESTERONE","name":"Progesterone","unit":"ng/mL","type":"numeric","decimals":2},{"code":"PROLACTIN","name":"Prolactin","unit":"ng/mL","type":"numeric","decimals":2}]'::jsonb),
  ('PCOS_EVALUATION_PROFILE','PCOS Evaluation Profile','Endocrinology / Gynecology',
   '[{"code":"FSH","name":"Follicle-stimulating hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"LH","name":"Luteinizing hormone","unit":"IU/L","type":"numeric","decimals":2},{"code":"TESTOSTERONE_TOTAL","name":"Testosterone, total","unit":"ng/dL","type":"numeric","decimals":2},{"code":"DHEAS","name":"Dehydroepiandrosterone sulfate","unit":"µg/dL","type":"numeric","decimals":2},{"code":"PROLACTIN","name":"Prolactin","unit":"ng/mL","type":"numeric","decimals":2},{"code":"TSH","name":"Thyroid-stimulating hormone","unit":"mIU/L","type":"numeric","decimals":2},{"code":"17_OHP","name":"17-hydroxyprogesterone","unit":"ng/dL","type":"numeric","decimals":2}]'::jsonb),
  ('TORCH_SEROLOGY_PROFILE','TORCH Serology Profile','Serology / Infectious Diseases',
   '[{"code":"TOXO_IGG","name":"Toxoplasma IgG","unit":"","type":"text","decimals":0},{"code":"TOXO_IGM","name":"Toxoplasma IgM","unit":"","type":"text","decimals":0},{"code":"RUBELLA_IGG","name":"Rubella IgG","unit":"","type":"text","decimals":0},{"code":"RUBELLA_IGM","name":"Rubella IgM","unit":"","type":"text","decimals":0},{"code":"CMV_IGG","name":"Cytomegalovirus IgG","unit":"","type":"text","decimals":0},{"code":"CMV_IGM","name":"Cytomegalovirus IgM","unit":"","type":"text","decimals":0}]'::jsonb),
  ('AUTOIMMUNE_SCREEN_PROFILE','Autoimmune Screening Profile','Immunology / Rheumatology',
   '[{"code":"ANA","name":"Antinuclear antibody","unit":"","type":"text","decimals":0},{"code":"ANTI_DSDNA","name":"Anti-double-stranded DNA antibody","unit":"IU/mL","type":"numeric","decimals":2},{"code":"ENA_SCREEN","name":"Extractable nuclear antigen screen","unit":"","type":"text","decimals":0},{"code":"C3","name":"Complement C3","unit":"mg/dL","type":"numeric","decimals":2},{"code":"C4","name":"Complement C4","unit":"mg/dL","type":"numeric","decimals":2}]'::jsonb),
  ('RHEUMATOLOGY_PROFILE','Rheumatology Profile','Immunology / Rheumatology',
   '[{"code":"RF","name":"Rheumatoid factor","unit":"IU/mL","type":"numeric","decimals":2},{"code":"ANTI_CCP","name":"Anti-CCP antibody","unit":"U/mL","type":"numeric","decimals":2},{"code":"CRP","name":"C-reactive protein","unit":"mg/L","type":"numeric","decimals":2},{"code":"ESR","name":"Erythrocyte sedimentation rate","unit":"mm/hr","type":"numeric","decimals":0}]'::jsonb),
  ('ANTENATAL_INFECTION_SCREEN_PROFILE','Antenatal Infection Screening Profile','Serology / Obstetrics',
   '[{"code":"HBSAG","name":"Hepatitis B surface antigen","unit":"","type":"text","decimals":0},{"code":"ANTI_HCV","name":"Hepatitis C antibody","unit":"","type":"text","decimals":0},{"code":"HIV_AG_AB","name":"HIV-1/2 antigen/antibody screen","unit":"","type":"text","decimals":0},{"code":"SYPHILIS_SCREEN","name":"Syphilis screening assay","unit":"","type":"text","decimals":0}]'::jsonb),
  ('PANCREATIC_ENZYME_PROFILE','Pancreatic Enzyme Profile','Clinical Chemistry',
   '[{"code":"AMYLASE","name":"Amylase","unit":"U/L","type":"numeric","decimals":0},{"code":"LIPASE","name":"Lipase","unit":"U/L","type":"numeric","decimals":0}]'::jsonb)
),
inserted as (
  insert into public.master_catalog_tests(
    release_id,master_code,canonical_name,alternate_names,test_kind,category,service_type,
    definition,clinical_review_status,source_name
  )
  select r.id,p.master_code,p.canonical_name,'{}','panel',p.category,'panel',
    jsonb_build_object(
      'reference_interval_note','No shared numeric reference intervals are supplied. The profile is an editable draft template; verify component selection, assay method, units and age/sex/pregnancy intervals locally before clinical use.',
      'clinical_review_note','Draft profile template — requires medical review and local method validation.'
    ),
    'needs_review','Taiba Smart Lab draft profile templates — pending clinical review'
  from profiles p cross join release_row r
  where not exists (
    select 1 from public.master_catalog_tests existing
    where existing.release_id=r.id and existing.master_code=p.master_code
  )
  returning id,master_code
)
insert into public.master_catalog_parameters(
  master_test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
  reference_ranges,critical_ranges,choices,display_order,is_required,result_source,
  clinical_review_status,reference_interval_status,clinical_metadata,source_references
)
select i.id,x.code,x.name,nullif(x.unit,''),x.type,x.decimals,
  '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,x.ord,true,'manual',
  'needs_review','local_verification_required',
  jsonb_build_object(
    'review_note','Draft profile component. Confirm assay/platform, reporting unit and local reference interval before use.',
    'reference_interval_note','No numeric interval supplied; editable locally by the tenant owner.'
  ),
  '[]'::jsonb
from inserted i
join profiles p using(master_code)
cross join lateral rows from (
  jsonb_to_recordset(p.parameters) as (code text,name text,unit text,type text,decimals smallint)
) with ordinality as x(code,name,unit,type,decimals,ord);
