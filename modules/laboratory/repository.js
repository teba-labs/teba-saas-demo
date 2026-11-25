import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES } from '../../core/data/schema-contract.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
const db = () => getSupabaseClient();

export async function listBranchWork({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(id, full_name, patient_number))')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .neq('status', 'cancelled').order('created_at');
  if (error) throw error;
  return data ?? [];
}


/** Server-side page for the active branch worklist; cancelled visits/tests are excluded. */
export async function listBranchWorkPage({ tenantId, branchId, page = 0, pageSize = 25 } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const safePage = Math.max(0, Math.floor(Number(page) || 0));
  const safeSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
  const from = safePage * safeSize;
  const requestedVisitId = new URLSearchParams(globalThis.location?.search || '').get('visit_id');
  const localWorklist=async()=>{
    const [cached,visits,patients]=await Promise.all([
      getCachedRows('visit_tests',{tenantId,branchId}),
      getCachedRows('visits',{tenantId,branchId}),
      getCachedRows('patients',{tenantId,branchId}),
    ]);
    const visitMap=new Map(visits.map(row=>[row.id,row]));
    const patientMap=new Map(patients.map(row=>[row.id,row]));
    const visible=cached.map(row=>{
      const visit=row.visits||visitMap.get(row.visit_id);
      if(!visit)return row;
      const patient=visit.patients||patientMap.get(visit.patient_id)||{};
      return {...row,visits:{...visit,patients:patient}};
    }).filter(row=>row.status!=='cancelled'&&row.visits?.status!=='cancelled'
      &&!row.visits?.workbench_hidden_at&&(!requestedVisitId||row.visit_id===requestedVisitId))
      .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
    return {rows:visible.slice(from,from+safeSize),count:visible.length,page:safePage,pageSize:safeSize,cached:true};
  };
  if (globalThis.navigator?.onLine === false) return localWorklist();
  let query = db().from(TABLES.visitTests)
    .select('id, tenant_id, branch_id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, tests_catalog(test_kind), visits!inner(id, patient_id, visit_number, visit_work_date, status, is_published, workbench_hidden_at, patients!inner(id, full_name, patient_number, phone, age_years, sex))', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .neq('status', 'cancelled').neq('visits.status', 'cancelled').is('visits.workbench_hidden_at', null);
  if (requestedVisitId) query = query.eq('visit_id', requestedVisitId);
  const { data, error, count } = await query.order('created_at').order('id').range(from, from + safeSize - 1);
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '')) return localWorklist();
    throw error;
  }
  await cacheRows('visit_tests', data ?? []);
  const visitRows=new Map();const patientRows=new Map();
  for(const row of data??[]){const visit=row.visits;if(!visit)continue;visitRows.set(row.visit_id,{...visit,id:row.visit_id,tenant_id:tenantId,branch_id:branchId});if(visit.patients?.id)patientRows.set(visit.patients.id,{...visit.patients,tenant_id:tenantId,branch_id:branchId});}
  if(visitRows.size)await cacheRows('visits',[...visitRows.values()]);
  if(patientRows.size)await cacheRows('patients',[...patientRows.values()]);
  return { rows: data ?? [], count: count ?? 0, page: safePage, pageSize: safeSize };
}

/** Complete, branch-scoped test list for a single approved visit report. */
export async function listVisitWorkForReport({ tenantId, branchId, visitId } = {}) {
  if (!tenantId || !branchId || !visitId) throw new Error('tenantId, branchId and visitId are required.');
  const localReportWork=async()=>{
    const [cached,visits,patients]=await Promise.all([
      getCachedRows('visit_tests',{tenantId,branchId}),
      getCachedRows('visits',{tenantId,branchId}),
      getCachedRows('patients',{tenantId,branchId}),
    ]);
    const visit=visits.find(row=>row.id===visitId);
    if(!visit||visit.status==='cancelled')return [];
    const patient=patients.find(row=>row.id===visit.patient_id)||visit.patients||{};
    return cached.filter(row=>row.visit_id===visitId&&row.status!=='cancelled'&&row.visits?.status!=='cancelled')
      .map(row=>({...row,visits:{...(row.visits||{}),...visit,patients:patient}}));
  };
  if (globalThis.navigator?.onLine === false) return localReportWork();
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, tests_catalog(test_kind), visits!inner(id, patient_id, visit_number, visit_work_date, status, is_published, patients!inner(id, full_name, patient_number, phone, age_years, sex))')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('visit_id', visitId)
    .neq('status', 'cancelled').neq('visits.status', 'cancelled')
    .order('created_at').order('id');
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) return localReportWork(); throw error; }
  await cacheRows('visit_tests', data ?? []);
  const visitRows=new Map();const patientRows=new Map();
  for(const row of data??[]){const visit=row.visits;if(!visit)continue;visitRows.set(row.visit_id,{...visit,id:row.visit_id,tenant_id:tenantId,branch_id:branchId});if(visit.patients?.id)patientRows.set(visit.patients.id,{...visit.patients,tenant_id:tenantId,branch_id:branchId});}
  if(visitRows.size)await cacheRows('visits',[...visitRows.values()]);
  if(patientRows.size)await cacheRows('patients',[...patientRows.values()]);
  return data ?? [];
}

export async function setVisitTestStatus({ tenantId, branchId, visitTestId, status } = {}) {
  if (!tenantId || !branchId || !visitTestId) throw new Error('tenantId, branchId and visitTestId are required.');
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) throw new Error('Unsupported visit-test status.');
  const { data, error } = await db().from(TABLES.visitTests)
    .update({ status }).eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', visitTestId)
    .select().single();
  if (error) throw error;
  return data;
}

/** Hidden visits remain in the database and can be restored by an authorized branch member. */
export async function listHiddenWorkbenchVisits({ tenantId, branchId, limit = 100 } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const { data, error } = await db().from(TABLES.visits)
    .select('id, visit_number, visit_work_date, status, workbench_hidden_at, workbench_hidden_reason, patients!inner(full_name,patient_number)')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .not('workbench_hidden_at', 'is', null)
    .order('workbench_hidden_at', { ascending: false }).limit(Math.min(200, Math.max(1, Number(limit) || 100)));
  if (error) throw error;
  return data ?? [];
}

export async function setVisitWorkbenchHidden({ tenantId, branchId, visitId, staffId, hidden, reason = '' } = {}) {
  if (!tenantId || !branchId || !visitId || !staffId || typeof hidden !== 'boolean') {
    throw new Error('tenantId, branchId, visitId, staffId and hidden are required.');
  }
  if (globalThis.navigator?.onLine === false) throw new Error('إخفاء الحالة أو استعادتها يحتاج اتصالًا بالإنترنت.');
  const { data, error } = await db().rpc('set_visit_workbench_hidden', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_id: visitId,
    p_staff_id: staffId, p_hidden: hidden, p_reason: String(reason || '').trim() || null,
  });
  if (error) throw error;
  return data;
}
