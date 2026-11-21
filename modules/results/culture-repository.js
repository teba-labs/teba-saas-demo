import { getSupabaseClient } from '../../core/supabase-client.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
import { enqueueOperation } from '../../offline/outbox.js';
const db = () => getSupabaseClient();
const need = (value,name) => { if (value === null || value === undefined || value === '') throw new Error(name+' is required.'); };

export async function listCultureResults({tenantId,branchId,visitTestIds}={}) {
  need(tenantId,'tenantId'); need(branchId,'branchId');
  if (!Array.isArray(visitTestIds) || !visitTestIds.length) return {isolates:[],susceptibilities:[]};
  if (globalThis.navigator?.onLine === false) {
    const isolates = (await getCachedRows('culture_isolates', { tenantId, branchId })).filter(row => visitTestIds.includes(row.visit_test_id));
    const ids = new Set(isolates.map(row => row.id));
    const susceptibilities = (await getCachedRows('culture_susceptibilities', { tenantId, branchId })).filter(row => ids.has(row.isolate_id));
    return { isolates, susceptibilities };
  }
  const {data:isolates,error:isoError}=await db().from('visit_test_culture_isolates')
    .select('id,tenant_id,branch_id,visit_test_id,isolate_number,organism_name,growth_description,colony_count,colony_count_unit,identification_method,notes,created_by_staff_id,created_at,updated_at')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).in('visit_test_id',visitTestIds).order('isolate_number');
  if(isoError) { if(/fetch|network|offline/i.test(isoError.message||'')){const cached=(await getCachedRows('culture_isolates',{tenantId,branchId})).filter(row=>visitTestIds.includes(row.visit_test_id));const ids=new Set(cached.map(row=>row.id));const ast=(await getCachedRows('culture_susceptibilities',{tenantId,branchId})).filter(row=>ids.has(row.isolate_id));return {isolates:cached,susceptibilities:ast};} throw isoError; }
  const ids=(isolates||[]).map(row=>row.id);
  if(!ids.length) return {isolates:[],susceptibilities:[]};
  const {data:susceptibilities,error:astError}=await db().from('visit_test_culture_susceptibility')
    .select('id,tenant_id,branch_id,isolate_id,antimicrobial_agent,test_method,measured_value,measured_unit,interpretation,breakpoint_standard,breakpoint_edition,breakpoint_table,breakpoint_source_url,qc_status,notes,entered_by_staff_id,created_at,updated_at')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).in('isolate_id',ids).order('antimicrobial_agent');
  if(astError) { if(/fetch|network|offline/i.test(astError.message||'')){const cached=(await getCachedRows('culture_susceptibilities',{tenantId,branchId})).filter(row=>ids.includes(row.isolate_id));return {isolates:isolates||[],susceptibilities:cached};} throw astError; }
  await cacheRows('culture_isolates', isolates || []);
  await cacheRows('culture_susceptibilities', susceptibilities || []);
  return {isolates:isolates||[],susceptibilities:susceptibilities||[]};
}

export async function saveCultureIsolate({tenantId,branchId,visitTestId,isolateNumber,organismName,growthDescription='',colonyCount=null,colonyCountUnit='CFU/mL',identificationMethod='',notes='',staffId,userId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[visitTestId,'visitTestId'],[organismName,'organismName'],[staffId,'staffId']]) need(v,n);
  const number=Number(isolateNumber);
  if(!Number.isInteger(number)||number<1||number>20) throw new Error('رقم العزلة يجب أن يكون من 1 إلى 20.');
  const count=colonyCount===''||colonyCount===null||colonyCount===undefined?null:Number(colonyCount);
  if(count!==null&&(!Number.isFinite(count)||count<0)) throw new Error('عدد المستعمرات غير صالح.');
  const operationId=crypto.randomUUID(),localId=crypto.randomUUID();
  const payload={isolate_number:number,organism_name:String(organismName).trim(),growth_description:String(growthDescription).trim()||null,
    colony_count:count,colony_count_unit:String(colonyCountUnit||'CFU/mL').trim(),
    identification_method:String(identificationMethod).trim()||null,notes:String(notes).trim()||null};
  const localTest=(await getCachedRows('visit_tests',{tenantId,branchId})).find(row=>row.id===visitTestId);
  const dependsOn=localTest?.local_intake_operation_id?[localTest.local_intake_operation_id]:[];
  if(globalThis.navigator?.onLine===false){
    const row={id:localId,tenant_id:tenantId,branch_id:branchId,visit_test_id:visitTestId,...payload,
      created_by_staff_id:staffId,created_by:userId||null,created_at:new Date().toISOString(),
      local_isolate_operation_id:operationId,local_offline:true};
    await enqueueOperation({tenantId,branchId,entityType:'culture_isolate',action:'upsert',operationId,
      payload:{visit_test_id:visitTestId,local_isolate_id:localId,staff_id:staffId,values:payload},dependsOn,priority:4});
    await cacheRows('culture_isolates',[row]);
    return row;
  }
  const {data,error}=await db().rpc('save_culture_isolate_idempotent',{
    p_operation_id:operationId,p_tenant_id:tenantId,p_branch_id:branchId,p_visit_test_id:visitTestId,p_staff_id:staffId,p_payload:payload,
  });
  if(error){
    if(/fetch|network|offline/i.test(error.message||'')){
      const row={id:localId,tenant_id:tenantId,branch_id:branchId,visit_test_id:visitTestId,...payload,
        created_by_staff_id:staffId,created_by:userId||null,created_at:new Date().toISOString(),
        local_isolate_operation_id:operationId,local_offline:true};
      await enqueueOperation({tenantId,branchId,entityType:'culture_isolate',action:'upsert',operationId,
        payload:{visit_test_id:visitTestId,local_isolate_id:localId,staff_id:staffId,values:payload},dependsOn,priority:4});
      await cacheRows('culture_isolates',[row]);return row;
    }
    throw error;
  }
  const row={id:data,tenant_id:tenantId,branch_id:branchId,visit_test_id:visitTestId,...payload,created_by_staff_id:staffId,created_by:userId||null};
  await cacheRows('culture_isolates',[row]);return row;
}

export async function saveCultureSusceptibility({tenantId,branchId,isolateId,antimicrobialAgent,testMethod,measuredValue=null,measuredUnit='',interpretation,breakpointStandard,breakpointEdition,breakpointTable='',breakpointSourceUrl='',qcStatus='not_documented',notes='',staffId,userId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[isolateId,'isolateId'],[antimicrobialAgent,'antimicrobialAgent'],[testMethod,'testMethod'],[interpretation,'interpretation'],[breakpointStandard,'breakpointStandard'],[breakpointEdition,'breakpointEdition'],[staffId,'staffId']]) need(v,n);
  const value=measuredValue===''||measuredValue===null||measuredValue===undefined?null:Number(measuredValue);
  if(value!==null&&(!Number.isFinite(value)||value<0)) throw new Error('قيمة MIC/قطر التثبيط غير صالحة.');
  if((value===null)!==(!String(measuredUnit).trim())) throw new Error('أدخل القيمة ووحدتها معًا أو اتركهما فارغين.');
  if(!['S','I','R','SDD','IE','NA','not_interpreted'].includes(interpretation))throw new Error('تفسير الحساسية غير صالح.');
  if(!['CLSI','EUCAST','other'].includes(breakpointStandard))throw new Error('معيار الحساسية غير صالح.');
  if(!['disk_diffusion','mic','automated','gradient_diffusion','other'].includes(testMethod))throw new Error('طريقة اختبار الحساسية غير صالحة.');
  if(!['not_documented','passed','failed'].includes(qcStatus))throw new Error('حالة ضبط الجودة غير صالحة.');
  const operationId=crypto.randomUUID(),localId=crypto.randomUUID();
  const values={antimicrobial_agent:String(antimicrobialAgent).trim(),test_method:testMethod,measured_value:value,
    measured_unit:value===null?null:String(measuredUnit).trim(),interpretation,breakpoint_standard:breakpointStandard,
    breakpoint_edition:String(breakpointEdition).trim(),breakpoint_table:String(breakpointTable).trim()||null,
    breakpoint_source_url:String(breakpointSourceUrl).trim()||null,qc_status:qcStatus,notes:String(notes).trim()||null};
  const localIsolate=(await getCachedRows('culture_isolates',{tenantId,branchId})).find(row=>row.id===isolateId);
  const dependsOn=localIsolate?.local_isolate_operation_id?[localIsolate.local_isolate_operation_id]:[];
  if(globalThis.navigator?.onLine===false){
    const row={id:localId,tenant_id:tenantId,branch_id:branchId,isolate_id:isolateId,...values,
      entered_by_staff_id:staffId,entered_by:userId||null,created_at:new Date().toISOString(),local_offline:true};
    await enqueueOperation({tenantId,branchId,entityType:'culture_susceptibility',action:'upsert',operationId,
      payload:{local_isolate_id:isolateId,staff_id:staffId,values},dependsOn,priority:5});
    await cacheRows('culture_susceptibilities',[row]);return row;
  }
  const {data,error}=await db().rpc('save_culture_susceptibility_idempotent',{
    p_operation_id:operationId,p_tenant_id:tenantId,p_branch_id:branchId,p_isolate_id:isolateId,p_staff_id:staffId,p_payload:values,
  });
  if(error){
    if(/fetch|network|offline/i.test(error.message||'')){
      const row={id:localId,tenant_id:tenantId,branch_id:branchId,isolate_id:isolateId,...values,
        entered_by_staff_id:staffId,entered_by:userId||null,created_at:new Date().toISOString(),local_offline:true};
      await enqueueOperation({tenantId,branchId,entityType:'culture_susceptibility',action:'upsert',operationId,
        payload:{local_isolate_id:isolateId,staff_id:staffId,values},dependsOn,priority:5});
      await cacheRows('culture_susceptibilities',[row]);return row;
    }
    throw error;
  }
  const row={id:data,tenant_id:tenantId,branch_id:branchId,isolate_id:isolateId,...values,entered_by_staff_id:staffId,entered_by:userId||null};
  await cacheRows('culture_susceptibilities',[row]);return row;
}
