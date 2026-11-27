import { getSupabaseClient } from '../../core/supabase-client.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { offlineDb } from '../../offline/database.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';

const db=()=>getSupabaseClient();
const safeText=value=>String(value??'').replace(/[%,_*]/g,' ').replace(/\s+/g,' ').trim();
function hiddenKey(tenantId,branchId,visitId){return 'device-visit-hidden:'+tenantId+':'+branchId+':'+visitId;}
async function localHiddenSet(tenantId,branchId){
  const rows=await offlineDb.sync_meta.toArray();
  return new Set(rows.filter(x=>x.tenant_id===tenantId&&(!branchId||x.branch_id===branchId)&&x.key?.startsWith('device-visit-hidden:')).map(x=>x.key));
}

/** Search the entire tenant for owners, or the employee's own branch, with exact server count. */
export async function listVisitHistory({tenantId,branchId=null,accountType='employee',search='',page=0,pageSize=25}={}){
  if(!tenantId)throw new Error('tenantId is required.');
  const size=Math.min(100,Math.max(1,Math.floor(Number(pageSize)||25)));
  const currentPage=Math.max(0,Math.floor(Number(page)||0));
  const from=currentPage*size;
  const term=safeText(search);
  if(globalThis.navigator?.onLine===false){
    const [visits,patients,tests,hidden]=await Promise.all([
      getCachedRows('visits',{tenantId}),
      getCachedRows('patients',{tenantId}),
      getCachedRows('visit_tests',{tenantId}),
      localHiddenSet(tenantId,branchId||''),
    ]);
    const patientMap=new Map(patients.map(x=>[x.id,x]));
    const testMap=new Map();
    for(const item of tests){if(!testMap.has(item.visit_id))testMap.set(item.visit_id,[]);testMap.get(item.visit_id).push(item);}
    const all=visits.filter(v=>(accountType!=='employee'||v.branch_id===branchId)
      &&!hidden.has(hiddenKey(tenantId,v.branch_id,v.id))
      &&(!term||((String(v.visit_number||'')+' '+String(v.patient_name||'')+' '+String(v.patients?.full_name||'')+' '+String(patientMap.get(v.patient_id)?.full_name||'')+' '+String(patientMap.get(v.patient_id)?.phone||'')+' '+String(patientMap.get(v.patient_id)?.patient_number||'')).toLowerCase().includes(term.toLowerCase()))))
      .map(v=>({...v,patients:v.patients||patientMap.get(v.patient_id)||{},visit_tests:testMap.get(v.id)||[]}))
      .sort((a,b)=>String(b.visit_work_date||b.created_at||'').localeCompare(String(a.visit_work_date||a.created_at||'')));
    return {rows:all.slice(from,from+size),count:all.length,totalCount:visits.filter(v=>accountType!=='employee'||v.branch_id===branchId).length,page:currentPage,pageSize:size,offline:true,complete:false};
  }
  let patientIds=[];
  if(term){
    for(let offset=0;offset<100000;offset+=1000){
      let pQuery=db().from('patients').select('id').eq('tenant_id',tenantId);
      if(accountType==='employee')pQuery=pQuery.eq('branch_id',branchId);
      pQuery=pQuery.or('full_name.ilike.%'+term+'%,phone.ilike.%'+term+'%,patient_number.ilike.%'+term+'%')
        .order('id').range(offset,offset+999);
      const {data,error}=await pQuery;
      if(error)throw error;
      const page=data||[];patientIds.push(...page.map(x=>x.id));
      if(page.length<1000)break;
    }
  }
  const selection='id,tenant_id,branch_id,patient_id,visit_number,visit_work_date,status,is_published,referred_by,notes,updated_at,created_at,patients!inner(id,full_name,phone,patient_number,age_value,age_unit,age_years,date_of_birth,sex,updated_at),visit_tests(id,test_name_snapshot,status)';
  const base=()=>{let q=db().from('visits').select(selection);q=q.eq('tenant_id',tenantId);if(accountType==='employee')q=q.eq('branch_id',branchId);return q;};
  let rows=[],count=0;
  if(term){
    const found=new Map();
    const collect=async build=>{
      for(let offset=0;offset<100000;offset+=500){
        const {data,error}=await build().order('visit_work_date',{ascending:false}).order('created_at',{ascending:false}).range(offset,offset+499);
        if(error)throw error;
        const page=data||[];for(const row of page)found.set(row.id,row);
        if(page.length<500)break;
      }
    };
    for(let i=0;i<patientIds.length;i+=250){
      const ids=patientIds.slice(i,i+250);
      await collect(()=>base().in('patient_id',ids));
    }
    await collect(()=>base().ilike('visit_number','%'+term+'%'));
    const all=[...found.values()].sort((a,b)=>String(b.visit_work_date||b.created_at||'').localeCompare(String(a.visit_work_date||a.created_at||'')));
    count=all.length;rows=all.slice(from,from+size);
  }else{
    const {data,error,count:serverCount}=await base().select(selection,{count:'exact'}).order('visit_work_date',{ascending:false}).order('created_at',{ascending:false}).range(from,from+size-1);
    if(error)throw error;
    rows=data||[];count=serverCount||0;
  }
  const hidden=await localHiddenSet(tenantId,null);
  rows=rows.filter(v=>!hidden.has(hiddenKey(tenantId,v.branch_id,v.id))).map(v=>({...v,patient_name:v.patients?.full_name||'مريض'}));
  let totalQuery=db().from('visits').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId);
  if(accountType==='employee')totalQuery=totalQuery.eq('branch_id',branchId);
  const totalResult=await totalQuery;
  if(totalResult.error)throw totalResult.error;

  if(rows.length){
    await cacheRows('visits',rows.map(({patients,visit_tests,...v})=>v));
    await cacheRows('patients',rows.map(v=>v.patients).filter(Boolean).map(p=>({...p,tenant_id:tenantId,branch_id:rows.find(v=>v.patients?.id===p.id)?.branch_id})));
    const testRows=rows.flatMap(v=>(v.visit_tests||[]).map(t=>({...t,tenant_id:tenantId,branch_id:v.branch_id,visit_id:v.id})));
    if(testRows.length)await cacheRows('visit_tests',testRows);
  }
  return {rows,count:count||0,totalCount:totalResult.count||0,page:currentPage,pageSize:size,offline:false,complete:true};
}

/** Preload historical visit summaries into the local browser so offline search covers the saved archive. */
export async function warmVisitHistory({tenantId,branchId=null,accountType='employee',maxRows=50000}={}){
  if(!tenantId)throw new Error('tenantId is required.');
  if(globalThis.navigator?.onLine===false)throw new Error('تحميل سجل الزيارات للاستخدام دون إنترنت يحتاج اتصالًا.');
  const limit=Math.min(100000,Math.max(500,Math.floor(Number(maxRows)||50000)));
  const rows=[];let total=null;
  for(let offset=0;offset<limit;offset+=500){
    let query=db().from('visits').select('id,tenant_id,branch_id,patient_id,visit_number,visit_work_date,status,is_published,referred_by,notes,updated_at,created_at,patients!inner(id,full_name,phone,patient_number,age_value,age_unit,age_years,date_of_birth,sex,updated_at)',{count:'exact'})
      .eq('tenant_id',tenantId).order('visit_work_date',{ascending:false}).order('id');
    if(accountType==='employee')query=query.eq('branch_id',branchId);
    const {data,error,count}=await query.range(offset,Math.min(offset+499,limit-1));
    if(error)throw error;
    if(total===null&&Number.isFinite(count))total=count;
    const page=data||[];rows.push(...page);
    if(page.length<500)break;
  }
  const patientRows=new Map();
  const visitRows=rows.map(({patients,...v})=>{if(patients)patientRows.set(patients.id,{...patients,tenant_id:tenantId,branch_id:v.branch_id});return v;});
  await cacheRows('visits',visitRows);
  if(patientRows.size)await cacheRows('patients',[...patientRows.values()]);
  for(let start=0;start<visitRows.length;start+=100){
    const ids=visitRows.slice(start,start+100).map(row=>row.id);
    if(!ids.length)continue;
    for(let offset=0;;offset+=500){
      const {data,error}=await db().from('visit_tests')
        .select('id,tenant_id,branch_id,visit_id,test_id,test_code_snapshot,test_name_snapshot,status,created_at')
        .eq('tenant_id',tenantId).in('visit_id',ids).range(offset,offset+499);
      if(error)throw error;
      const page=data||[];
      if(page.length)await cacheRows('visit_tests',page);
      if(page.length<500)break;
    }
  }
  return {cachedRows:rows.length,totalRows:total??rows.length,truncated:(total??rows.length)>rows.length};
}

export async function updatePatientDemographics({tenantId,branchId,patient,staffId}={}){
  if(!tenantId||!branchId||!patient?.id||!staffId)throw new Error('بيانات تعديل المريض غير مكتملة.');
  const payload={full_name:String(patient.full_name||'').trim(),phone:String(patient.phone||'').trim()||null,
    sex:patient.sex||'unknown',date_of_birth:patient.date_of_birth||null,
    age_value:patient.age_value===''||patient.age_value==null?null:Number(patient.age_value),
    age_unit:patient.age_unit||'years',expected_updated_at:patient.updated_at||null};
  if(!payload.full_name)throw new Error('اسم المريض مطلوب.');
  const pending=await offlineDb.outbox.where('[tenant_id+branch_id]').equals([tenantId,branchId]).toArray();
  const createDependency=pending.find(op=>op.entity_type==='patients'&&op.payload?.id===patient.id)?.operation_id;
  const queue=async()=>{
    await enqueueOperation({tenantId,branchId,entityType:'patient_update',action:'update',
      payload:{patient_id:patient.id,staff_id:staffId,...payload,local_patient_pending:Boolean(createDependency)},
      dependsOn:createDependency?[createDependency]:[],priority:2});
    await cacheRows('patients',[{...patient,...payload,local_update_pending:true}]);
    return {queued:true};
  };
  if(globalThis.navigator?.onLine===false||createDependency)return queue();
  const {data,error}=await db().rpc('update_patient_demographics',{
    p_tenant_id:tenantId,p_branch_id:branchId,p_patient_id:patient.id,p_staff_id:staffId,
    p_full_name:payload.full_name,p_phone:payload.phone,p_sex:payload.sex,p_date_of_birth:payload.date_of_birth,
    p_age_value:payload.age_value,p_age_unit:payload.age_unit,p_expected_updated_at:payload.expected_updated_at,
  });
  if(error){if(/fetch|network|offline/i.test(error.message||''))return queue();throw error;}
  await cacheRows('patients',[data]);
  return data;
}

export async function updateVisitDetails({tenantId,branchId,visit,staffId}={}){
  if(!tenantId||!branchId||!visit?.id||!staffId)throw new Error('بيانات تعديل الزيارة غير مكتملة.');
  const payload={referred_by:String(visit.referred_by||'').trim()||null,notes:String(visit.notes||'').trim()||null,expected_updated_at:visit.updated_at||null,local_visit_pending:Boolean(visit.local_intake_operation_id)};
  const queue=async()=>{
    await enqueueOperation({tenantId,branchId,entityType:'visit_update',action:'update',payload:{visit_id:visit.id,staff_id:staffId,...payload},dependsOn:visit.local_intake_operation_id?[visit.local_intake_operation_id]:[],priority:2});
    await cacheRows('visits',[{...visit,...payload,local_update_pending:true}]);
    return {queued:true};
  };
  if(globalThis.navigator?.onLine===false||payload.local_visit_pending)return queue();
  const {data,error}=await db().rpc('update_visit_details',{
    p_tenant_id:tenantId,p_branch_id:branchId,p_visit_id:visit.id,p_staff_id:staffId,
    p_referred_by:payload.referred_by,p_notes:payload.notes,p_expected_updated_at:payload.expected_updated_at,
  });
  if(error){if(/fetch|network|offline/i.test(error.message||''))return queue();throw error;}
  await cacheRows('visits',[data]);
  return data;
}

export async function cancelVisit({tenantId,branchId,visitId,staffId}={}){
  if(!tenantId||!branchId||!visitId||!staffId)throw new Error('بيانات إلغاء الزيارة غير مكتملة.');
  const payload={visit_id:visitId,staff_id:staffId};
  const localVisit=(await getCachedRows('visits',{tenantId,branchId})).find(x=>x.id===visitId);
  const queue=async()=>{
    await enqueueOperation({tenantId,branchId,entityType:'visit_cancel',action:'cancel',payload:{...payload,local_visit_pending:Boolean(localVisit?.local_intake_operation_id)},dependsOn:localVisit?.local_intake_operation_id?[localVisit.local_intake_operation_id]:[],priority:2});
    if(localVisit)await cacheRows('visits',[{...localVisit,status:'cancelled',local_cancel_pending:true}]);
    return {queued:true};
  };
  if(globalThis.navigator?.onLine===false||localVisit?.local_intake_operation_id)return queue();
  const {data,error}=await db().rpc('cancel_visit_atomic',{p_tenant_id:tenantId,p_branch_id:branchId,p_visit_id:visitId,p_staff_id:staffId});
  if(error){if(/fetch|network|offline/i.test(error.message||''))return queue();throw error;}
  await cacheRows('visits',[data]);return data;
}

export async function cancelVisitTest({tenantId,branchId,visitTest,staffId}={}){
  if(!tenantId||!branchId||!visitTest?.id||!staffId)throw new Error('بيانات حذف التحليل غير مكتملة.');
  const localVisit=(await getCachedRows('visits',{tenantId,branchId})).find(row=>row.id===visitTest.visit_id);
  const queue=async()=>{
    await enqueueOperation({tenantId,branchId,entityType:'visit_test_cancel',action:'cancel',
      payload:{visit_test_id:visitTest.id,visit_id:visitTest.visit_id,staff_id:staffId,visit_test_pending:Boolean(localVisit?.local_intake_operation_id)},
      dependsOn:localVisit?.local_intake_operation_id?[localVisit.local_intake_operation_id]:[],priority:2});
    await cacheRows('visit_tests',[{...visitTest,status:'cancelled',local_cancel_pending:true}]);
    return {queued:true};
  };
  if(globalThis.navigator?.onLine===false||localVisit?.local_intake_operation_id)return queue();
  const {data,error}=await db().rpc('cancel_visit_test_atomic',{p_tenant_id:tenantId,p_branch_id:branchId,p_visit_test_id:visitTest.id,p_staff_id:staffId});
  if(error){if(/fetch|network|offline/i.test(error.message||''))return queue();throw error;}
  await cacheRows('visit_tests',[data]);return data;
}

async function purgeVisitLocalData({tenantId,branchId,visitId}){
  const tests=await offlineDb.visit_tests.where('visit_id').equals(visitId).toArray();
  const testIds=tests.map(row=>row.id).filter(Boolean);
  const isolates=testIds.length?await offlineDb.culture_isolates.where('visit_test_id').anyOf(testIds).toArray():[];
  const isolateIds=isolates.map(row=>row.id).filter(Boolean);
  await offlineDb.transaction('rw',offlineDb.visits,offlineDb.visit_tests,offlineDb.test_results,
    offlineDb.culture_isolates,offlineDb.culture_susceptibilities,offlineDb.sync_meta,async()=>{
      if(testIds.length){
        await offlineDb.test_results.where('visit_test_id').anyOf(testIds).delete();
        await offlineDb.visit_tests.where('id').anyOf(testIds).delete();
        await offlineDb.culture_isolates.where('visit_test_id').anyOf(testIds).delete();
      }
      if(isolateIds.length)await offlineDb.culture_susceptibilities.where('isolate_id').anyOf(isolateIds).delete();
      await offlineDb.visits.delete(visitId);
      const meta=await offlineDb.sync_meta.toArray();
      for(const row of meta){
        const rangeForTest=testIds.some(id=>row.key?.startsWith('range-override:'+id+':'));
        if(row.key!==hiddenKey(tenantId,branchId,visitId)
          &&row.tenant_id===tenantId&&row.branch_id===branchId
          &&(row.visit_id===visitId||row.visit_test_id&&testIds.includes(row.visit_test_id)||rangeForTest))
          await offlineDb.sync_meta.delete(row.key);
      }
    });
}

export async function deleteVisitPermanently({tenantId,branchId,visitId,staffId}={}){
  if(!tenantId||!branchId||!visitId||!staffId)throw new Error('بيانات الحذف غير مكتملة.');
  if(globalThis.navigator?.onLine===false)throw new Error('الحذف النهائي يحتاج اتصالًا بالسحابة.');
  const [queued,tests]=await Promise.all([
    offlineDb.outbox.where('[tenant_id+branch_id]').equals([tenantId,branchId]).toArray(),
    offlineDb.visit_tests.where('visit_id').equals(visitId).toArray(),
  ]);
  const testIds=new Set(tests.map(test=>test.id));
  if(queued.some(op=>{const p=op.payload||{};return p.visit_id===visitId||p.local_visit_id===visitId
    ||testIds.has(p.visit_test_id)||(Array.isArray(p.visit_test_ids)&&p.visit_test_ids.some(id=>testIds.has(id)));}))
    throw new Error('توجد عمليات تخص الزيارة لم تتم مزامنتها. أكمل المزامنة أولًا ثم نفّذ الحذف النهائي.');
  const {data,error}=await db().rpc('delete_visit_permanently',{p_tenant_id:tenantId,p_branch_id:branchId,p_visit_id:visitId,p_staff_id:staffId});
  if(error)throw error;
  await purgeVisitLocalData({tenantId,branchId,visitId});
  return data;
}

/** Removes this visit and its local results from this browser only; server copies stay untouched. */
export async function hideVisitOnThisDevice({tenantId,branchId,visitId}={}){
  if(!tenantId||!branchId||!visitId)throw new Error('بيانات الإخفاء المحلي غير مكتملة.');
  const [queued,tests]=await Promise.all([
    offlineDb.outbox.where('[tenant_id+branch_id]').equals([tenantId,branchId]).toArray(),
    offlineDb.visit_tests.where('visit_id').equals(visitId).toArray(),
  ]);
  const testIds=new Set(tests.map(test=>test.id));
  const hasPending=queued.some(op=>{
    const p=op.payload||{};
    return p.visit_id===visitId||p.local_visit_id===visitId||testIds.has(p.visit_test_id)
      ||(Array.isArray(p.visit_test_ids)&&p.visit_test_ids.some(id=>testIds.has(id)));
  });
  if(hasPending)throw new Error('توجد تعديلات تنتظر المزامنة لهذه الزيارة. أكمل المزامنة أولًا ثم أزل النسخة المحلية.');
  const key=hiddenKey(tenantId,branchId,visitId);
  await offlineDb.sync_meta.put({key,tenant_id:tenantId,branch_id:branchId,visit_id:visitId,hidden:true,updated_at:new Date().toISOString()});
  await purgeVisitLocalData({tenantId,branchId,visitId});
  return true;
}
