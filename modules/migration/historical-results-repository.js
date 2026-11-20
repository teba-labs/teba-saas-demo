import { getSupabaseClient } from '../../core/supabase-client.js';

const db = () => getSupabaseClient();
const need = (value, name) => { if (!value) throw new Error(name + ' is required.'); };
const safeFileName = value => String(value || 'legacy-results.xlsx').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);

/** Search is branch-scoped; callers must let the owner confirm a match manually. */
export async function findHistoricalPatientCandidates({ tenantId, branchId, name, limit = 8 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const term = String(name || '').trim().replace(/[%,_*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (term.length < 2) return [];
  const { data, error } = await db().from('patients')
    .select('id,full_name,patient_number,age_years,created_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .ilike('full_name', '%' + term + '%')
    .order('created_at', { ascending: false })
    .limit(Math.min(20, Math.max(1, Number(limit) || 8)));
  if (error) throw error;
  const patients = data || [];
  if (!patients.length) return [];
  const ids = patients.map(row => row.id);
  const { data: visits, error: visitsError } = await db().from('visits')
    .select('patient_id,visit_work_date')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .in('patient_id', ids)
    .order('visit_work_date', { ascending: false }).limit(Math.min(200, ids.length * 5));
  if (visitsError) throw visitsError;
  const dates = new Map();
  for (const visit of visits || []) {
    const list = dates.get(visit.patient_id) || [];
    if (list.length < 3) list.push(visit.visit_work_date);
    dates.set(visit.patient_id, list);
  }
  return patients.map(row => ({ ...row, recent_visit_dates: dates.get(row.id) || [] }));
}

/** Import batches and source files are owner-only; the original workbook is retained in private storage. */
export async function importHistoricalResults({
  tenantId, branchId, userId, file, fileSha256, sheetName, mappingSnapshot = {}, sheetSummary = [], records = []
} = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(userId, 'userId');
  need(file, 'file'); need(fileSha256, 'fileSha256'); need(sheetName, 'sheetName');
  if (!Array.isArray(records) || !records.length) throw new Error('لا توجد نتائج تاريخية صالحة للاعتماد.');
  if (records.length > 50000) throw new Error('الملف يتجاوز 50 ألف نتيجة في الدفعة الواحدة؛ قسّمه إلى ملفات أصغر.');
  const client = db();
  const { data: existing, error: lookupError } = await client.from('historical_import_batches')
    .select('id,status,rows_inserted,rows_total,storage_path,created_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('source_file_sha256', fileSha256).eq('source_sheet_name', sheetName).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.status === 'completed') throw new Error('هذا الملف وهذه الورقة سبق استيرادهما بنجاح لهذا الفرع. رقم الدفعة: ' + existing.id + '. لن نكرر النتائج.');

  const sheetKey = safeFileName(sheetName).replace(/\.xlsx?$/i,'').slice(0,60) || 'sheet';
  const path = tenantId + '/' + branchId + '/historical-imports/' + fileSha256 + '-' + sheetKey + '-' + safeFileName(file.name);
  let batch=existing;
  if (!batch) {
    const { error: uploadError } = await client.storage.from('tenant-backups').upload(path, file, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      cacheControl: '3600', upsert: false
    });
    if (uploadError) throw uploadError;
    try {
      const { data, error } = await client.from('historical_import_batches').insert({
        tenant_id: tenantId, branch_id: branchId, source_file_name: file.name, source_sheet_name: sheetName,
        source_file_sha256: fileSha256, storage_path: path, mapping_snapshot: mappingSnapshot,
        sheet_summary: sheetSummary, status: 'processing', rows_total: records.length, created_by: userId
      }).select('id').single();
      if (error) throw error;
      batch = data;
    } catch (error) {
      await client.storage.from('tenant-backups').remove([path]);
      throw error;
    }
  } else {
    const { error } = await client.from('historical_import_batches').update({ status: 'processing', rows_total: records.length, mapping_snapshot: mappingSnapshot, sheet_summary: sheetSummary }).eq('tenant_id', tenantId).eq('id', batch.id);
    if (error) throw error;
  }

  let inserted = 0, skipped = 0, failed = 0;
  const failures = [];
  for (let offset = 0; offset < records.length; offset += 100) {
    const chunk = records.slice(offset, offset + 100).map(row => ({
      tenant_id: tenantId, branch_id: branchId, import_batch_id: batch.id,
      patient_id: row.patient_id || null, patient_name_snapshot: row.patient_name_snapshot,
      test_code: row.test_code, test_name_snapshot: row.test_name_snapshot,
      result_date: row.result_date, result_at: row.result_at || null,
      result_data: row.result_data || {}, source: 'import', created_by: userId,
      source_file_name: file.name, source_file_sha256: fileSha256,
      source_sheet_name: row.source_sheet_name, source_row_number: row.source_row_number,
      source_record_key: row.source_record_key, patient_age_raw: row.patient_age_raw || null,
      patient_age_unit: row.patient_age_unit || null, original_row: row.original_row || {}
    }));
    try {
      const { data, error } = await client.from('historical_results')
        .upsert(chunk, { onConflict: 'tenant_id,branch_id,source_record_key', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      const count = (data || []).length;
      inserted += count;
      skipped += chunk.length - count;
    } catch (error) {
      failed += chunk.length;
      if (failures.length < 20) failures.push({ start: offset + 1, end: offset + chunk.length, message: error.message || 'تعذر حفظ المجموعة.' });
    }
  }

  const { count: storedCount, error: countError } = await client.from('historical_results').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('branch_id', branchId).eq('import_batch_id', batch.id);
  if (countError) throw countError;
  const totalInserted = Number(storedCount || 0);
  const status = failed ? (totalInserted ? 'partial' : 'failed') : 'completed';
  const totalSkipped = Math.max(0, records.length - totalInserted - failed);
  const { error: updateError } = await client.from('historical_import_batches').update({
    status, rows_inserted: totalInserted, rows_skipped: totalSkipped, rows_failed: failed,
    completed_at: new Date().toISOString()
  }).eq('tenant_id', tenantId).eq('id', batch.id);
  if (updateError) throw updateError;
  return { batchId: batch.id, status, inserted: totalInserted, skipped: totalSkipped, failed, failures, sourcePath: batch.storage_path || path };
}

/** Historical results are never joined to visits or billing. */
export async function listHistoricalResults({ tenantId, branchId, patientId = null, search = '', limit = 100 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  let query = db().from('historical_results')
    .select('id,patient_id,patient_name_snapshot,test_code,test_name_snapshot,result_date,result_at,result_data,source,source_file_name,source_sheet_name,source_row_number,patient_age_raw,patient_age_unit,created_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .order('result_date', { ascending: false })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)));
  if (patientId) query = query.eq('patient_id', patientId);
  const term = String(search || '').trim().replace(/[%,_*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!patientId && term.length >= 2) query = query.ilike('patient_name_snapshot', '%' + term + '%');
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listHistoricalImportTemplates({ tenantId, branchId, sheetName } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(sheetName, 'sheetName');
  const { data, error } = await db().from('historical_import_templates')
    .select('id,sheet_name,header_signature,headers_json,entity_type,column_mapping,updated_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('sheet_name', sheetName)
    .order('updated_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}

export async function saveHistoricalImportTemplate({ tenantId, branchId, userId, sheetName, headerSignature, headers, entityType, columnMapping } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(userId, 'userId');
  need(sheetName, 'sheetName'); need(headerSignature, 'headerSignature');
  const { data, error } = await db().from('historical_import_templates').upsert({
    tenant_id: tenantId, branch_id: branchId, sheet_name: sheetName,
    header_signature: headerSignature, headers_json: headers || [],
    entity_type: entityType || 'historical_results', column_mapping: columnMapping || [],
    updated_by: userId
  }, { onConflict: 'tenant_id,branch_id,sheet_name,header_signature' })
    .select('id,updated_at').single();
  if (error) throw error;
  return data;
}
