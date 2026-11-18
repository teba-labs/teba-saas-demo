import { getSupabaseClient } from '../../core/supabase-client.js';
const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };

export async function listReportVersions({ tenantId, visitId } = {}) {
  need(tenantId, 'tenantId'); need(visitId, 'visitId');
  const { data, error } = await db().from('report_versions')
    .select('id, tenant_id, branch_id, visit_id, version_number, storage_path, change_reason, published_by_staff_id, created_at, is_published, published_at')
    .eq('tenant_id', tenantId).eq('visit_id', visitId).order('version_number', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Uploads the PDF through the authenticated server workflow; never inserts a report row directly. */
export async function publishReportVersion({ tenantId, branchId, visitId, staffId, file, changeReason = '' } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId');
  need(staffId, 'staffId'); need(file, 'file');
  if (!(file instanceof File) || file.type !== 'application/pdf') throw new Error('A PDF report file is required.');
  if (file.size > 10 * 1024 * 1024) throw new Error('PDF must not exceed 10 MB.');
  const form = new FormData();
  form.set('tenantId', tenantId);
  form.set('branchId', branchId);
  form.set('visitId', visitId);
  form.set('staffId', staffId);
  form.set('changeReason', String(changeReason).trim());
  form.set('report', file, file.name || 'report.pdf');
  const { data, error } = await db().functions.invoke('publish-report', { body: form });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'Report publication failed.');
  return data;
}

/** Audited clinical correction. A new PDF version must be published after the correction. */
export async function correctPublishedResult({ tenantId, branchId, visitId, resultId, valueNumeric = null, valueText = null, reason, staffId } = {}) {
  for (const [v, n] of [[tenantId,'tenantId'],[branchId,'branchId'],[visitId,'visitId'],[resultId,'resultId'],[reason,'reason'],[staffId,'staffId']]) need(v, n);
  const numeric = valueNumeric === '' || valueNumeric === null || valueNumeric === undefined ? null : Number(valueNumeric);
  const textValue = valueText === '' || valueText === null || valueText === undefined ? null : String(valueText);
  if ((numeric === null) === (textValue === null)) throw new Error('Provide exactly one numeric or text result value.');
  if (numeric !== null && !Number.isFinite(numeric)) throw new Error('Numeric result is invalid.');
  const { data, error } = await db().rpc('correct_published_result', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_id: visitId,
    p_result_id: resultId, p_value_numeric: numeric, p_value_text: textValue,
    p_reason: String(reason).trim(), p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

/** Authenticated staff download; storage bucket is private and RLS checks tenant/visit path. */
export async function createReportDownloadUrl({ storagePath, expiresIn = 90 } = {}) {
  need(storagePath, 'storagePath');
  const seconds = Math.min(Math.max(Number(expiresIn) || 90, 30), 300);
  const { data, error } = await db().storage.from('tenant-reports').createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export function publicationRequiresServerWorkflow() {
  return {
    ready: false,
    implementationReady: true,
    deployedToTest: true,
    endpoint: 'publish-report',
    atomicDatabasePublication: true,
    auditedCorrections: true,
    requiredSecrets: ['REPORT_ALLOWED_ORIGINS'],
    reason: 'The Edge Function is deployed to TEST. Configure REPORT_ALLOWED_ORIGINS, then complete authenticated PDF upload and publication tests.',
  };
}
