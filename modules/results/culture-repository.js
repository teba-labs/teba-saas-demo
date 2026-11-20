import { getSupabaseClient } from '../../core/supabase-client.js';
const db = () => getSupabaseClient();
const need = (value,name) => { if (value === null || value === undefined || value === '') throw new Error(name+' is required.'); };

export async function listCultureResults({tenantId,branchId,visitTestIds}={}) {
  need(tenantId,'tenantId'); need(branchId,'branchId');
  if (!Array.isArray(visitTestIds) || !visitTestIds.length) return {isolates:[],susceptibilities:[]};
  const {data:isolates,error:isoError}=await db().from('visit_test_culture_isolates')
    .select('id,tenant_id,branch_id,visit_test_id,isolate_number,organism_name,growth_description,colony_count,colony_count_unit,identification_method,notes,created_by_staff_id,created_at,updated_at')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).in('visit_test_id',visitTestIds).order('isolate_number');
  if(isoError) throw isoError;
  const ids=(isolates||[]).map(row=>row.id);
  if(!ids.length) return {isolates:[],susceptibilities:[]};
  const {data:susceptibilities,error:astError}=await db().from('visit_test_culture_susceptibility')
    .select('id,tenant_id,branch_id,isolate_id,antimicrobial_agent,test_method,measured_value,measured_unit,interpretation,breakpoint_standard,breakpoint_edition,breakpoint_table,breakpoint_source_url,qc_status,notes,entered_by_staff_id,created_at,updated_at')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).in('isolate_id',ids).order('antimicrobial_agent');
  if(astError) throw astError;
  return {isolates:isolates||[],susceptibilities:susceptibilities||[]};
}

export async function saveCultureIsolate({tenantId,branchId,visitTestId,isolateNumber,organismName,growthDescription='',colonyCount=null,colonyCountUnit='CFU/mL',identificationMethod='',notes='',staffId,userId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[visitTestId,'visitTestId'],[organismName,'organismName'],[staffId,'staffId']]) need(v,n);
  const number=Number(isolateNumber);
  if(!Number.isInteger(number)||number<1||number>20) throw new Error('رقم العزلة يجب أن يكون من 1 إلى 20.');
  const count=colonyCount===''||colonyCount===null||colonyCount===undefined?null:Number(colonyCount);
  if(count!==null&&(!Number.isFinite(count)||count<0)) throw new Error('عدد المستعمرات غير صالح.');
  const payload={tenant_id:tenantId,branch_id:branchId,visit_test_id:visitTestId,isolate_number:number,
    organism_name:String(organismName).trim(),growth_description:String(growthDescription).trim()||null,
    colony_count:count,colony_count_unit:String(colonyCountUnit||'CFU/mL').trim(),
    identification_method:String(identificationMethod).trim()||null,notes:String(notes).trim()||null,
    created_by_staff_id:staffId,created_by:userId||null};
  const {data,error}=await db().from('visit_test_culture_isolates').upsert(payload,{onConflict:'visit_test_id,isolate_number'}).select().single();
  if(error) throw error;
  return data;
}

export async function saveCultureSusceptibility({tenantId,branchId,isolateId,antimicrobialAgent,testMethod,measuredValue=null,measuredUnit='',interpretation,breakpointStandard,breakpointEdition,breakpointTable='',breakpointSourceUrl='',qcStatus='not_documented',notes='',staffId,userId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[isolateId,'isolateId'],[antimicrobialAgent,'antimicrobialAgent'],[testMethod,'testMethod'],[interpretation,'interpretation'],[breakpointStandard,'breakpointStandard'],[breakpointEdition,'breakpointEdition'],[staffId,'staffId']]) need(v,n);
  const value=measuredValue===''||measuredValue===null||measuredValue===undefined?null:Number(measuredValue);
  if(value!==null&&(!Number.isFinite(value)||value<0)) throw new Error('قيمة MIC/قطر التثبيط غير صالحة.');
  if((value===null)!==(!String(measuredUnit).trim())) throw new Error('أدخل القيمة ووحدتها معًا أو اتركهما فارغين.');
  const payload={tenant_id:tenantId,branch_id:branchId,isolate_id:isolateId,
    antimicrobial_agent:String(antimicrobialAgent).trim(),test_method:testMethod,
    measured_value:value,measured_unit:value===null?null:String(measuredUnit).trim(),
    interpretation,breakpoint_standard:breakpointStandard,breakpoint_edition:String(breakpointEdition).trim(),
    breakpoint_table:String(breakpointTable).trim()||null,breakpoint_source_url:String(breakpointSourceUrl).trim()||null,
    qc_status:qcStatus,notes:String(notes).trim()||null,entered_by_staff_id:staffId,entered_by:userId||null};
  const {data,error}=await db().from('visit_test_culture_susceptibility').upsert(payload,{onConflict:'isolate_id,antimicrobial_agent'}).select().single();
  if(error) throw error;
  return data;
}
