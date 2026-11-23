-- 096: Source-backed completion of the remaining common core screening profiles.
begin;

-- Mark test-level methods/specimens and source provenance.
update public.master_catalog_tests t
   set clinical_review_status='verified',
       source_name='Mayo Clinic Laboratories public test catalog; CDC/ADA clinical guidance',
       definition=coalesce(t.definition,'{}'::jsonb)||case t.master_code
         when 'BONE_PROFILE' then jsonb_build_object('method','Automated chemistry: calcium/phosphate/albumin photometric; ALP enzymatic. Method-specific intervals apply.','specimen','Serum','reporting_notes','ALP is strongly age- and sex-dependent; pediatric values must use the displayed age bands. Albumin affects interpretation of total calcium.')
         when 'ELECTROLYTE_PROFILE' then jsonb_build_object('method','Ion-selective electrode for sodium, potassium and chloride; total CO2/bicarbonate enzymatic or photometric chemistry.','specimen','Serum or heparinized plasma; follow analyzer validation.','reporting_notes','Avoid EDTA contamination for potassium; serum/plasma and method-specific intervals apply.')
         when 'GLYCEMIC_CONTROL_PROFILE' then jsonb_build_object('method','Glucose: hexokinase or validated enzymatic chemistry; HbA1c: NGSP-certified HPLC/immunoassay.','specimen','Fluoride plasma or validated serum for glucose; EDTA whole blood for HbA1c.','reporting_notes','Fasting glucose requires >=8-hour fast. Two-hour OGTT thresholds must not be applied to an ordinary mixed meal unless the protocol is a 75-g OGTT.')
         when 'PANCREATIC_ENZYME_PROFILE' then jsonb_build_object('method','Amylase enzymatic substrate method; lipase enzymatic colorimetric method; source intervals are reagent-specific.','specimen','Serum')
         when 'AUTOIMMUNE_SCREEN_PROFILE' then jsonb_build_object('method','ANA ELISA; anti-dsDNA IgG ELISA with confirmatory Crithidia IFA when indicated; ENA immunoassay; C3/C4 nephelometry.','specimen','Serum','reporting_notes','Assay cutoffs differ. A negative screen does not exclude connective-tissue disease; interpret in clinical context.')
         when 'RHEUMATOLOGY_PROFILE' then jsonb_build_object('method','RF and anti-CCP immunoassays; CRP immunoturbidimetry; ESR Westergren.','specimen','Serum for RF/anti-CCP/CRP; EDTA whole blood for ESR (separate tube).','reporting_notes','RF and anti-CCP are supportive, not diagnostic alone. ESR depends on age, sex and method.')
         when 'THYROID_ANTIBODY_PROFILE' then jsonb_build_object('method','Automated immunoassay; Mayo source uses method-specific antibody assays.','specimen','Serum','reporting_notes','Antibody thresholds are assay-specific. TRAb is a decision limit, not a general population interval.')
         when 'PCOS_EVALUATION_PROFILE' then jsonb_build_object('method','FSH/LH/prolactin/TSH by immunoassay; testosterone and 17-OHP by LC-MS/MS where possible; DHEA-S method-specific immunoassay.','specimen','Serum','reporting_notes','Interpret with age, menstrual-cycle phase, pregnancy status, time of collection and assay method. This profile does not diagnose PCOS by itself.')
         when 'ANTENATAL_INFECTION_SCREEN_PROFILE' then jsonb_build_object('method','Automated serologic immunoassays; reactive screening results require the relevant confirmatory algorithm.','specimen','Serum or plasma validated by each assay.','reporting_notes','Reactive HIV, HBsAg, HCV and syphilis screening results must be confirmed according to current national/WHO/CDC algorithms before diagnosis.')
         when 'TORCH_SEROLOGY_PROFILE' then jsonb_build_object('method','Automated IgG/IgM immunoassays; assay-specific qualitative or quantitative interpretation.','specimen','Serum','reporting_notes','IgG positivity may represent prior exposure or immunity; IgM alone does not establish recent primary infection. Use avidity/paired sera/confirmatory testing where indicated.')
         when 'CARDIAC_MARKERS_PROFILE' then jsonb_build_object('method','Total CK and LDH enzymatic activity; CK-MB and cardiac troponin I immunoassays. Troponin and CK-MB decision limits must be the exact manufacturer assay 99th percentile.','specimen','Serum or plasma according to the specific assay manufacturer.','reporting_notes','No universal troponin I numeric cutoff. Do not transfer 99th-percentile thresholds between assays; use serial change and clinical context.')
         else t.definition
       end,
       updated_at=now()
 where t.master_code in ('BONE_PROFILE','ELECTROLYTE_PROFILE','GLYCEMIC_CONTROL_PROFILE','PANCREATIC_ENZYME_PROFILE','AUTOIMMUNE_SCREEN_PROFILE','RHEUMATOLOGY_PROFILE','THYROID_ANTIBODY_PROFILE','PCOS_EVALUATION_PROFILE','ANTENATAL_INFECTION_SCREEN_PROFILE','TORCH_SEROLOGY_PROFILE','CARDIAC_MARKERS_PROFILE')
   and exists(select 1 from public.master_catalog_releases r where r.id=t.release_id and r.version='taiba-core-2026.11.20-r1');

-- Bone profile.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'CALCIUM_TOTAL' then jsonb_build_array(
   jsonb_build_object('age',jsonb_build_object('min',0,'max',1,'unit','years','min_unit','years','max_unit','years'),'lower',8.7,'upper',11.0,'unit','mg/dL','source','Mayo 601514'),
   jsonb_build_object('age',jsonb_build_object('min',1,'max',17,'unit','years','min_unit','years','max_unit','years'),'lower',9.3,'upper',10.6,'unit','mg/dL','source','Mayo 601514'),
   jsonb_build_object('age',jsonb_build_object('min',18,'max',59,'unit','years','min_unit','years','max_unit','years'),'lower',8.6,'upper',10.0,'unit','mg/dL','source','Mayo 601514'),
   jsonb_build_object('age',jsonb_build_object('min',60,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',8.8,'upper',10.2,'unit','mg/dL','source','Mayo 601514')),
  when 'PHOSPHATE' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',2.5,'upper',4.5,'unit','mg/dL','source','Mayo 8408','population','Adults; pediatric intervals are age/sex dependent.')),
  when 'ALP' then jsonb_build_array(jsonb_build_object('text','Adults: Male >=19 y 40–129 U/L; Female >=17 y 35–104 U/L. Pediatric ALP is markedly age- and sex-dependent: Mayo bands include male 1–<10 y 142–335, 10–<13 y 129–417, 13–<15 y 116–468, 15–<17 y 82–331; female 1–<10 y 142–335, 10–<13 y 129–417, 13–<15 y 57–254, 15–<17 y 50–117 U/L. Use full source bands for pediatric interpretation.','source','Mayo 8340','population','Age- and sex-specific; text display until detailed pediatric range editor supports all age bands.')),
  when 'ALBUMIN' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',1,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',3.5,'upper',5.0,'unit','g/dL','source','Mayo CMP 113631','population','Age >=12 months')),
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',
 clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'CALCIUM_TOTAL' then jsonb_build_array(jsonb_build_object('id','MAYO-601514','title','Calcium, Total, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/601514','method','Automated colorimetric; age-specific.'))
  when 'PHOSPHATE' then jsonb_build_array(jsonb_build_object('id','MAYO-8408','title','Phosphorus (Inorganic), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/8408','method','Photometric; age- and sex-specific.'))
  when 'ALP' then jsonb_build_array(jsonb_build_object('id','MAYO-8340','title','Alkaline Phosphatase, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/8340','method','Enzymatic; strongly age- and sex-dependent.'))
  when 'ALBUMIN' then jsonb_build_array(jsonb_build_object('id','MAYO-113631','title','Comprehensive Metabolic Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/113631','scope','Albumin 3.5–5.0 g/dL, age >=12 months.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo method-specific source interval; local analyzer verification required.','method_notes','Pediatric intervals may differ substantially, especially ALP.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='BONE_PROFILE'
 and p.parameter_code in ('CALCIUM_TOTAL','PHOSPHATE','ALP','ALBUMIN');

-- Electrolytes.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'SODIUM' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',1,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',135,'upper',145,'unit','mmol/L','source','Mayo Electrolyte Panel 113632'))
  when 'POTASSIUM' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',1,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',3.6,'upper',5.2,'unit','mmol/L','source','Mayo Electrolyte Panel 113632'))
  when 'CHLORIDE' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',98,'upper',107,'unit','mmol/L','source','Mayo Electrolyte Panel 113632'))
  when 'BICARBONATE' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',22,'upper',29,'unit','mmol/L','source','Mayo Electrolyte Panel 113632'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=jsonb_build_array(jsonb_build_object('id','MAYO-113632','title','Electrolyte Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/113632','method','Ion-selective electrode and chemistry; age-specific.')),
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo source interval; sample type and ISE method must match local analyzer.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='ELECTROLYTE_PROFILE'
 and p.parameter_code in ('SODIUM','POTASSIUM','CHLORIDE','BICARBONATE');

-- Glycemic control.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'GLUCOSE_FASTING' then jsonb_build_array(jsonb_build_object('text','Normal fasting plasma glucose: 70–99 mg/dL; increased risk/prediabetes: 100–125 mg/dL; diabetes threshold: >=126 mg/dL (confirm according to diagnostic criteria). Requires >=8-hour fast.','source','ADA Standards of Care / Mayo glucose criteria','population','Fasting plasma/serum; diagnostic thresholds are not a general reference interval.'))
  when 'GLUCOSE_2H_PP' then jsonb_build_array(jsonb_build_object('text','For a standardized 75-g oral glucose tolerance test: <140 mg/dL normal; 140–199 mg/dL impaired glucose tolerance; >=200 mg/dL diabetes threshold (confirm as indicated). These OGTT thresholds must not be applied to an ordinary mixed meal without a validated protocol.','source','ADA diagnostic criteria / Mayo glucose interpretation','population','75-g OGTT only; not interchangeable with an ordinary post-meal glucose.'))
  when 'HBA1C' then jsonb_build_array(jsonb_build_object('text','Mayo: 4.0–5.6% reference; 5.7–6.4% increased risk/prediabetes; >=6.5% diabetes diagnostic threshold (confirm as indicated). Criteria not established for children <18 years.','source','Mayo HBA1C 82080 / ADA','population','Adults; NGSP-certified method required.'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'GLUCOSE_FASTING' then jsonb_build_array(jsonb_build_object('id','ADA-FPG','title','Diabetes Diagnosis & Tests','organization','American Diabetes Association','url','https://diabetes.org/about-diabetes/diagnosis','scope','Fasting plasma glucose criteria.'))
  when 'GLUCOSE_2H_PP' then jsonb_build_array(jsonb_build_object('id','MAYO-GLURA-89115','title','Glucose, Random, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/89115','scope','Diagnostic 2-hour 75-g OGTT threshold; not a mixed meal.'))
  when 'HBA1C' then jsonb_build_array(jsonb_build_object('id','MAYO-HBA1C-82080','title','Hemoglobin A1c, Blood','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/82080','scope','4.0–5.6%; ADA prediabetes and diabetes categories.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','clinical_decision_categories','reference_interval_note','These are diagnostic decision categories, not interchangeable post-meal reference intervals. Verify specimen, fasting status and method.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='GLYCEMIC_CONTROL_PROFILE'
 and p.parameter_code in ('GLUCOSE_FASTING','GLUCOSE_2H_PP','HBA1C');

-- Pancreatic enzymes.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'AMYLASE' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',28,'upper',100,'unit','U/L','source','Mayo Amylase Total Serum 8352','population','Adults; pediatric values are age-specific.'))
  when 'LIPASE' then jsonb_build_array(jsonb_build_object('lower',13,'upper',60,'unit','U/L','source','Mayo Lipase Serum 8328','population','Mayo method-specific interval.'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'AMYLASE' then jsonb_build_array(jsonb_build_object('id','MAYO-8352','title','Amylase, Total, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8352','method','Roche enzymatic substrate method; age-specific.'))
  when 'LIPASE' then jsonb_build_array(jsonb_build_object('id','MAYO-8328','title','Lipase, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/8328','method','Mayo enzymatic colorimetric; 13–60 U/L.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo method-specific comparison interval; local analyzer verification required.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='PANCREATIC_ENZYME_PROFILE'
 and p.parameter_code in ('AMYLASE','LIPASE');

-- Autoimmune profile.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'ANA' then jsonb_build_array(jsonb_build_object('text','Negative is the expected result. If ELISA is used, Mayo assay: <=1.0 U negative; 1.1–2.9 weakly positive; 3.0–5.9 positive; >=6.0 strongly positive. ANA IFA titer/pattern thresholds are method-specific and must not use ELISA units.','source','Mayo ANA Serum 619915','population','Assay-specific; ANA ELISA units are not interchangeable with IFA titers.'))
  when 'ANTI_DSDNA' then jsonb_build_array(jsonb_build_object('lower',0,'upper',99.9,'unit','IU/mL','source','Mayo dsDNA IgG 620809','population','Mayo ELISA; <100 IU/mL negative, >=100 positive.'))
  when 'ENA_SCREEN' then jsonb_build_array(jsonb_build_object('text','Negative / Not detected according to the specific ENA assay and antigen panel. Positive individual antigen results must be reported separately; a negative screen does not exclude connective-tissue disease.','source','Mayo Connective Tissue Disease Cascade','population','Assay-specific multiplex/solid-phase immunoassay.'))
  when 'C3' then jsonb_build_array(jsonb_build_object('lower',75,'upper',175,'unit','mg/dL','source','Mayo Complement C3 800019','population','Mayo nephelometry.'))
  when 'C4' then jsonb_build_array(jsonb_build_object('lower',14,'upper',40,'unit','mg/dL','source','Mayo Complement C4 800020','population','Mayo nephelometry.'))
  else p.reference_ranges end,
 reference_interval_status=case when p.value_type='text' then 'not_applicable' else 'local_verification_required' end,
 clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'ANA' then jsonb_build_array(jsonb_build_object('id','MAYO-619915','title','Antinuclear Antibodies (ANA), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/619915','method','ELISA; IFA titers are not interchangeable.'))
  when 'ANTI_DSDNA' then jsonb_build_array(jsonb_build_object('id','MAYO-620809','title','Double-Stranded DNA (dsDNA) Antibodies, IgG, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/620809','method','ELISA; Crithidia IFA may be used for confirmation.'))
  when 'ENA_SCREEN' then jsonb_build_array(jsonb_build_object('id','MAYO-CTD-CASCADE','title','Connective Tissue Disease Cascade','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog','scope','Individual antigen panel and method-specific interpretation.'))
  when 'C3' then jsonb_build_array(jsonb_build_object('id','MAYO-800019','title','Complement C3, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800019','method','Nephelometry.'))
  when 'C4' then jsonb_build_array(jsonb_build_object('id','MAYO-800020','title','Complement C4, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/800020','method','Nephelometry.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo source; method-specific. ANA ELISA units, ANA IFA titers and ENA panels must not be mixed.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='AUTOIMMUNE_SCREEN_PROFILE'
 and p.parameter_code in ('ANA','ANTI_DSDNA','ENA_SCREEN','C3','C4');

-- Rheumatology profile.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'RF' then jsonb_build_array(jsonb_build_object('lower',0,'upper',14.9,'unit','IU/mL','source','Mayo Rheumatoid Arthritis Panel 620062','population','Mayo RF assay; <15 IU/mL.'))
  when 'ANTI_CCP' then jsonb_build_array(jsonb_build_object('text','Negative <20.0 U; Weak positive 20.0–39.9 U; Positive 40.0–59.9 U; Strong positive >=60.0 U.','source','Mayo Rheumatoid Arthritis Panel 620062','population','Mayo CCP IgG assay; units are assay-specific.'))
  when 'CRP' then jsonb_build_array(jsonb_build_object('lower',0,'upper',5,'unit','mg/L','source','Mayo CRP Serum 9731','population','Mayo standard CRP; not hs-CRP cardiovascular risk interpretation.'))
  when 'ESR' then jsonb_build_array(jsonb_build_object('text','Typical Westergren upper limits: males <=50 y <15 mm/hr; males >50 y <20 mm/hr; females <=50 y <20 mm/hr; females >50 y <30 mm/hr. Age, sex, anemia, pregnancy and method affect interpretation; use the locally validated interval.','source','Westergren ESR clinical reference guidance','population','Adult age- and sex-dependent comparison values.'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'RF' then jsonb_build_array(jsonb_build_object('id','MAYO-620062','title','Rheumatoid Arthritis Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/620062','scope','RF <15 IU/mL.'))
  when 'ANTI_CCP' then jsonb_build_array(jsonb_build_object('id','MAYO-620062','title','Rheumatoid Arthritis Panel, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/620062','scope','CCP IgG negative <20 U; graded positivity.'))
  when 'CRP' then jsonb_build_array(jsonb_build_object('id','MAYO-9731','title','C-Reactive Protein (CRP), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/9731','method','Particle-enhanced immunoturbidimetry; <5 mg/L.'))
  when 'ESR' then jsonb_build_array(jsonb_build_object('id','WESTERGREN-ESR','title','Erythrocyte Sedimentation Rate - Westergren method','organization','International Council for Standardization in Haematology','url','https://www.icsh.org/','scope','Age- and sex-dependent method-specific reference limits; local verification required.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo assay-specific values; ESR is age/sex and method dependent. These markers support but do not independently diagnose rheumatoid disease.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='RHEUMATOLOGY_PROFILE'
 and p.parameter_code in ('RF','ANTI_CCP','CRP','ESR');

-- Thyroid autoantibodies.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'ANTI_TPO' then jsonb_build_array(jsonb_build_object('lower',0,'upper',9,'unit','IU/mL','source','Mayo Thyroid Autoantibodies Profile 82041'))
  when 'ANTI_TG' then jsonb_build_array(jsonb_build_object('lower',0,'upper',4,'unit','IU/mL','source','Mayo Thyroid Autoantibodies Profile 82041'))
  when 'TRAB' then jsonb_build_array(jsonb_build_object('lower',0,'upper',1.75,'unit','IU/L','source','Mayo TRAb Serum 81797','population','Mayo decision limit; assay-specific.'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'ANTI_TPO' then jsonb_build_array(jsonb_build_object('id','MAYO-82041','title','Thyroid Autoantibodies Profile, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/82041','scope','Anti-TPO <9 IU/mL.'))
  when 'ANTI_TG' then jsonb_build_array(jsonb_build_object('id','MAYO-82041','title','Thyroid Autoantibodies Profile, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/82041','scope','Anti-thyroglobulin <4 IU/mL.'))
  when 'TRAB' then jsonb_build_array(jsonb_build_object('id','MAYO-81797','title','Thyrotropin Receptor Antibody, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/81797','scope','Decision limit <=1.75 IU/L.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo assay-specific antibody cutoffs; local analyzer verification required.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='THYROID_ANTIBODY_PROFILE'
 and p.parameter_code in ('ANTI_TPO','ANTI_TG','TRAB');

-- PCOS evaluation profile.
update public.master_catalog_parameters p set
 reference_ranges=case p.parameter_code
  when 'FSH' then jsonb_build_array(jsonb_build_object('text','Adult female: Follicular 2.9–14.6 IU/L; Midcycle 4.7–23.2 IU/L; Luteal 1.4–8.9 IU/L; Postmenopausal 16.0–157.0 IU/L.','source','Mayo FSH 602753','population','Cycle phase required for interpretation.'))
  when 'LH' then jsonb_build_array(jsonb_build_object('text','Adult female: Follicular 1.9–14.6 IU/L; Midcycle 12.2–118 IU/L; Luteal 0.7–12.9 IU/L; Postmenopausal 5.3–65.4 IU/L.','source','Mayo LH 602752','population','Cycle phase required for interpretation.'))
  when 'TESTOSTERONE_TOTAL' then jsonb_build_array(jsonb_build_object('sex','female','age',jsonb_build_object('min',19,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',8,'upper',60,'unit','ng/dL','source','Mayo Testosterone Total Mass Spectrometry 8533','population','Adult females; LC-MS/MS.'))
  when 'DHEAS' then jsonb_build_array(jsonb_build_object('text','Adult females (µg/dL): 18–30 y 83–377; 31–40 y 45–295; 41–50 y 27–240; 51–60 y 16–195; 61–70 y 9.7–159; >=71 y 5.3–124. Pubertal Tanner-stage intervals differ.','source','Mayo DHEA-S 113595','population','Age-specific adult female intervals.'))
  when 'PROLACTIN' then jsonb_build_array(jsonb_build_object('sex','female','age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',4.8,'upper',23.3,'unit','ng/mL','source','Mayo Prolactin 800091','population','Adult females.'))
  when 'TSH' then jsonb_build_array(jsonb_build_object('age',jsonb_build_object('min',18,'max',120,'unit','years','min_unit','years','max_unit','years'),'lower',0.3,'upper',4.2,'unit','mIU/L','source','Mayo TSH Serum; adult method-specific interval.'))
  when '17_OHP' then jsonb_build_array(jsonb_build_object('text','Adult females: Follicular phase <80 ng/dL; Luteal phase <285 ng/dL; Postmenopausal <51 ng/dL. For screening of nonclassic CAH, collect in the early follicular phase; method-specific LC-MS/MS.','source','Mayo 17-Hydroxyprogesterone Serum 9231','population','Cycle phase and collection time required.'))
  else p.reference_ranges end,
 reference_interval_status='local_verification_required',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'FSH' then jsonb_build_array(jsonb_build_object('id','MAYO-602753','title','Follicle-Stimulating Hormone (FSH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602753'))
  when 'LH' then jsonb_build_array(jsonb_build_object('id','MAYO-602752','title','Luteinizing Hormone (LH), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/602752'))
  when 'TESTOSTERONE_TOTAL' then jsonb_build_array(jsonb_build_object('id','MAYO-8533','title','Testosterone, Total, Mass Spectrometry, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8533','method','LC-MS/MS.'))
  when 'DHEAS' then jsonb_build_array(jsonb_build_object('id','MAYO-113595','title','Dehydroepiandrosterone Sulfate, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/Overview/113595','scope','Adult female age-specific intervals.'))
  when 'PROLACTIN' then jsonb_build_array(jsonb_build_object('id','MAYO-800091','title','Prolactin, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/800091'))
  when 'TSH' then jsonb_build_array(jsonb_build_object('id','MAYO-TSH','title','Thyroid-Stimulating Hormone, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog'))
  when '17_OHP' then jsonb_build_array(jsonb_build_object('id','MAYO-9231','title','17-Hydroxyprogesterone, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/9231/17-hydroxyprogesterone-serum','method','LC-MS/MS; cycle phase-specific.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','external_source_suggested','reference_interval_note','Mayo method-specific values. Interpret with menstrual phase, age, collection time and assay method; not a standalone PCOS diagnostic profile.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='PCOS_EVALUATION_PROFILE'
 and p.parameter_code in ('FSH','LH','TESTOSTERONE_TOTAL','DHEAS','PROLACTIN','TSH','17_OHP');

-- TORCH serology: qualitative expected results are explicit, not blank numeric ranges.
update public.master_catalog_parameters p set
 reference_ranges=jsonb_build_array(jsonb_build_object('text',case p.parameter_code
  when 'TOXO_IGG' then 'Interpret as Nonreactive / Equivocal / Reactive using the exact assay cutoff. IgG reactivity may reflect past infection; pair with IgM and avidity when recent infection is suspected.'
  when 'TOXO_IGM' then 'Nonreactive is expected. Reactive or equivocal IgM requires confirmatory testing and clinical correlation; IgM alone does not prove acute infection.'
  when 'RUBELLA_IGG' then 'Interpret using assay-specific immunity threshold. Many assays define >=10 IU/mL as evidence of immunity; verify exact manufacturer cutoff.'
  when 'RUBELLA_IGM' then 'Nonreactive is expected. Reactive IgM requires confirmation and clinical correlation due false-positive/persistent IgM.'
  when 'CMV_IGG' then 'Interpret as Nonreactive / Reactive per assay. Reactive IgG usually indicates previous exposure and does not establish recent primary infection.'
  when 'CMV_IGM' then 'Nonreactive is expected. Reactive IgM alone does not establish primary CMV infection; use IgG avidity, paired sera and clinical context.'
  else 'Qualitative assay-specific result.' end,
  'source','Mayo Clinic Laboratories and CDC congenital infection guidance',
  'population','Pregnancy interpretation requires gestational timing and confirmatory algorithms.')),
 reference_interval_status='not_applicable',clinical_review_status='verified',
 source_references=jsonb_build_array(jsonb_build_object('id','CDC-CMV-PREGNANCY','title','Clinical Overview of CMV and Congenital CMV','organization','CDC','url','https://www.cdc.gov/cytomegalovirus/hcp/clinical-overview/index.html','scope','Serology interpretation and congenital CMV context.'),
 jsonb_build_object('id','MAYO-TORCH','title','TORCH Serology Test Catalog','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog','scope','Assay-specific serology cutoffs and method details.')),
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','qualitative_expected_finding','reference_interval_note','Qualitative serology: use the exact assay cutoff and confirmatory algorithm. IgG/IgM patterns alone do not establish timing of infection.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='TORCH_SEROLOGY_PROFILE';

-- Antenatal infection screening.
update public.master_catalog_parameters p set
 reference_ranges=jsonb_build_array(jsonb_build_object('text',case p.parameter_code
  when 'HBSAG' then 'Nonreactive is expected. A reactive screen requires confirmatory testing and full hepatitis B serologic interpretation.'
  when 'ANTI_HCV' then 'Nonreactive is expected. A reactive antibody screen indicates exposure and requires HCV RNA testing to determine current infection.'
  when 'HIV_AG_AB' then 'Nonreactive is expected. A reactive 4th-generation screen must be followed by HIV-1/HIV-2 differentiation assay and NAT according to the diagnostic algorithm.'
  when 'SYPHILIS_SCREEN' then 'Nonreactive is expected. Reactive screening requires reflex treponemal/non-treponemal testing and interpretation with history/treatment.'
  else 'Qualitative screen; use assay-specific interpretation.' end,
  'source','CDC/WHO screening and confirmatory algorithms',
  'population','Antenatal screening; reactive screens are not final diagnoses.')),
 reference_interval_status='not_applicable',clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'HBSAG' then jsonb_build_array(jsonb_build_object('id','CDC-HBV-PREG','title','Screening and Testing for Hepatitis B Virus Infection','organization','CDC','url','https://www.cdc.gov/hepatitis-b/hcp/diagnosis-testing/index.html','scope','HBsAg screening and confirmatory testing.'))
  when 'ANTI_HCV' then jsonb_build_array(jsonb_build_object('id','CDC-HCV-TEST','title','Clinical Screening and Diagnosis for Hepatitis C','organization','CDC','url','https://www.cdc.gov/hepatitis-c/hcp/diagnosis-testing/index.html','scope','Reactive antibody requires HCV RNA.'))
  when 'HIV_AG_AB' then jsonb_build_array(jsonb_build_object('id','CDC-HIV-ALGORITHM','title','HIV Testing','organization','CDC','url','https://www.cdc.gov/hiv/testing/index.html','scope','4th generation screen and confirmatory algorithm.'))
  when 'SYPHILIS_SCREEN' then jsonb_build_array(jsonb_build_object('id','CDC-SYPHILIS','title','Laboratory Recommendations for Syphilis Testing','organization','CDC','url','https://www.cdc.gov/mmwr/volumes/73/rr/rr7301a1.htm','scope','Screening and confirmatory testing algorithms.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_source_type','qualitative_expected_finding','reference_interval_note','Reactive screening results require confirmatory testing before reporting a final diagnosis.')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='ANTENATAL_INFECTION_SCREEN_PROFILE';

-- Cardiac markers: preserve method-specific decision limits rather than inventing
-- a universal troponin cutoff. This profile remains importable with explicit caution.
update public.master_catalog_parameters p set
 unit=case p.parameter_code when 'CK_MB' then 'ng/mL' when 'TROPONIN_I' then 'ng/L' else p.unit end,
 reference_ranges=case p.parameter_code
  when 'CK_TOTAL' then jsonb_build_array(jsonb_build_object('sex','male','lower',39,'upper',308,'unit','U/L','source','Mayo CK Serum 8336'),jsonb_build_object('sex','female','lower',26,'upper',192,'unit','U/L','source','Mayo CK Serum 8336'))
  when 'CK_MB' then jsonb_build_array(jsonb_build_object('text','Mass assay only: interpret using the exact manufacturer cutoff and assay-specific 99th percentile. CK-MB activity assays use different units and thresholds; do not interchange.','source','Assay manufacturer insert','population','Method-specific cardiac marker.'))
  when 'TROPONIN_I' then jsonb_build_array(jsonb_build_object('text','Use the exact assay-specific 99th percentile upper reference limit (sex-specific when provided by manufacturer). No universal Troponin I cutoff exists across conventional and high-sensitivity assays. Interpret serial change with clinical presentation and ECG.','source','IFCC cardiac troponin assay-specific 99th percentile guidance','population','Assay-specific; never transfer thresholds between platforms.'))
  when 'LDH' then jsonb_build_array(jsonb_build_object('lower',122,'upper',222,'unit','U/L','source','Mayo LDH Serum method-specific adult interval'))
  else p.reference_ranges end,
 reference_interval_status=case when p.parameter_code in ('CK_MB','TROPONIN_I') then 'not_applicable' else 'local_verification_required' end,
 clinical_review_status='verified',
 source_references=case p.parameter_code
  when 'CK_TOTAL' then jsonb_build_array(jsonb_build_object('id','MAYO-8336','title','Creatine Kinase (CK), Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog/overview/8336','scope','Male 39–308 U/L; female 26–192 U/L.'))
  when 'CK_MB' then jsonb_build_array(jsonb_build_object('id','IFCC-CKMB','title','CK-MB assay-specific reference limits','organization','IFCC / assay manufacturer','url','https://www.ifcc.org/','scope','Mass and activity assays are not interchangeable.'))
  when 'TROPONIN_I' then jsonb_build_array(jsonb_build_object('id','IFCC-CARDIAC-TROPONIN','title','Cardiac troponin assay-specific 99th percentile','organization','IFCC','url','https://www.ifcc.org/','scope','Use the exact assay 99th percentile; high-sensitivity and conventional methods differ.'))
  when 'LDH' then jsonb_build_array(jsonb_build_object('id','MAYO-LDH','title','Lactate Dehydrogenase, Serum','organization','Mayo Clinic Laboratories','url','https://www.mayocliniclabs.com/test-catalog','scope','Method-specific adult LDH comparison interval.'))
  else p.source_references end,
 clinical_metadata=coalesce(p.clinical_metadata,'{}'::jsonb)||jsonb_build_object('reference_interval_note','Troponin I and CK-MB are assay-specific; configure the exact instrument/reagent 99th percentile before automatic flagging.','reference_interval_source_type','assay_specific_decision_limit')
 from public.master_catalog_tests t where p.master_test_id=t.id and t.master_code='CARDIAC_MARKERS_PROFILE'
 and p.parameter_code in ('CK_TOTAL','CK_MB','TROPONIN_I','LDH');

commit;
