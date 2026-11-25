import { loadMyTenantContext } from '../core/tenant/context.js';
import { offlineDb, assertOfflineDatabaseReady, getOfflineStorageHealth } from './database.js';
import { replaceCachedRows } from './cache.js';
import { getOutboxSummary } from './outbox.js';
import { listCatalog, listCurrentPrices, warmCatalogParameters } from '../modules/catalog/repository.js';
import { warmBranchPatients } from '../modules/reception/repository.js';
import { listBranchStaff } from '../modules/staff/repository.js';
import { getCurrentWorkday, listExpenseCategories, getWorkdayCashSummary, getLatestClosing } from '../modules/workday/repository.js';
import { getLabSettings, getPrintSettings } from '../modules/settings/repository.js';
import { listBranchWorkPage } from '../modules/laboratory/repository.js';
import { listResultsForVisitTests, listVisitParameterRangeOverrides } from '../modules/results/repository.js';
import { listCultureResults } from '../modules/results/culture-repository.js';
import { getOfflineEntitlementStatus, refreshOfflineEntitlement } from './entitlement.js';

const preparationKey = (tenantId, branchId) => `offline-prepared:${tenantId}:${branchId}`;

export async function getOfflinePreparationStatus({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) return null;
  const row = await offlineDb.sync_meta.get(preparationKey(tenantId, branchId));
  return row?.value ?? null;
}

/**
 * Warm the current branch's required working set before an expected outage.
 * This is a preparation pass, not a claim that every historical record is on
 * this device. Patient directory and active worklist limits are reported.
 */
export async function prepareOfflineBranch({ tenantId, branchId, onProgress = () => {} } = {}) {
  if (!tenantId || !branchId) throw new Error('اختَر المعمل والفرع أولًا.');
  if (globalThis.navigator?.onLine === false) throw new Error('تهيئة الأوف لاين تحتاج اتصالًا بالإنترنت.');
  await assertOfflineDatabaseReady();

  const context = await loadMyTenantContext();
  const tenant = (context.tenants || []).find(item => item.id === tenantId);
  const branch = tenant?.branches?.find(item => item.id === branchId);
  if (!tenant || !branch) throw new Error('هذا الحساب لا يملك صلاحية تهيئة بيانات هذا الفرع.');

  const progress = (step, detail = '') => {
    try { onProgress({ step, detail }); } catch { /* UI progress must not interrupt preparation */ }
  };

  progress('catalog', 'تحميل دليل التحاليل النشط');
  const catalog = await listCatalog({ tenantId });
  const testIds = catalog.map(row => row.id).filter(Boolean);

  progress('core', 'تجهيز الأسعار والبارامترات والموظفين وبيانات التشغيل');
  const [
    prices,
    parameterCount,
    staff,
    workday,
    expenseCategories,
    labSettings,
    printSettings,
    patients,
  ] = await Promise.all([
    listCurrentPrices({ tenantId, branchId, testIds }),
    warmCatalogParameters({ tenantId, testIds }),
    listBranchStaff({ tenantId, branchId }),
    getCurrentWorkday({ tenantId, branchId }),
    listExpenseCategories({ tenantId }),
    getLabSettings({ tenantId }),
    getPrintSettings({ tenantId, branchId }),
    warmBranchPatients({ tenantId, branchId, maxRows: 10000 }),
  ]);
  await replaceCachedRows('staff_directory', staff, { tenantId, branchId });

  progress('worklist', 'تحميل قائمة العمل والنتائج المحفوظة');
  const pageSize = 100;
  const maxWorklistRows = 500;
  const worklist = [];
  let worklistCount = 0;
  for (let page = 0; page < maxWorklistRows / pageSize; page++) {
    const result = await listBranchWorkPage({ tenantId, branchId, page, pageSize });
    worklistCount = result.count ?? worklistCount;
    worklist.push(...(result.rows || []));
    if (worklist.length >= worklistCount || (result.rows || []).length < pageSize) break;
  }
  const visitTestIds = [...new Set(worklist.map(row => row.id).filter(Boolean))];
  const rangeOverrides = visitTestIds.length ? await listVisitParameterRangeOverrides({ tenantId, branchId, visitTestIds }) : [];
  const results = visitTestIds.length
    ? await listResultsForVisitTests({ tenantId, visitTestIds })
    : [];
  const culture = visitTestIds.length
    ? await listCultureResults({ tenantId, branchId, visitTestIds })
    : { isolates: [], susceptibilities: [] };

  progress('cash', 'حفظ ملخص اليوم وآخر إغلاق');
  const [cashSummary, latestClosing] = workday
    ? await Promise.all([
        getWorkdayCashSummary({ tenantId, branchId, workDate: workday.work_date }),
        getLatestClosing({ tenantId, branchId }),
      ])
    : [null, await getLatestClosing({ tenantId, branchId })];

  const outbox = await getOutboxSummary({ tenantId, branchId });
  let entitlementError = null;
  try { await refreshOfflineEntitlement({ tenantId, branchId }); }
  catch (error) { entitlementError = error?.message || String(error); }
  const entitlement = await getOfflineEntitlementStatus({ tenantId, branchId });
  const storage = await getOfflineStorageHealth();
  const preparedAt = new Date().toISOString();
  const missingPrices = Math.max(0, testIds.length - prices.length);
  const worklistTruncated = worklist.length < worklistCount;
  const issues = [];
  if (entitlement.status !== 'valid') issues.push(`الترخيص الإلكتروني غير جاهز: ${entitlementError || entitlement.message || entitlement.status}.`);
  if (!catalog.length) issues.push('لا يوجد كتالوج تحاليل نشط محفوظ.');
  if (missingPrices) issues.push(`يوجد ${missingPrices} تحليلًا دون سعر حالي محفوظ.`);
  if (!staff.length) issues.push('لا يوجد موظف نشط محفوظ لهذا الفرع.');
  // A branch may open its next workday offline; staff and expense categories are warmed above.
  if (patients.truncated) issues.push('دليل المرضى أكبر من حد التحميل المحلي.');
  if (worklistTruncated) issues.push('قائمة العمل أكبر من حد التحميل المحلي.');
  const report = {
    tenant_id: tenantId,
    branch_id: branchId,
    prepared_at: preparedAt,
    complete: issues.length === 0,
    issues,
    counts: {
      catalog_tests: catalog.length,
      current_prices: prices.length,
      tests_without_current_price: missingPrices,
      parameters: parameterCount,
      staff: staff.length,
      patients: patients.cachedRows,
      patients_available: patients.totalRows,
      worklist: worklist.length,
      worklist_available: worklistCount,
      results: results.length,
      range_overrides: rangeOverrides.length,
      culture_isolates: culture.isolates?.length ?? 0,
      culture_susceptibilities: culture.susceptibilities?.length ?? 0,
      expense_categories: expenseCategories.length,
      pending_operations: outbox.total,
    },
    truncated: {
      patient_directory: patients.truncated,
      worklist: worklistTruncated,
    },
    has_open_workday: Boolean(workday),
    has_lab_settings: Boolean(labSettings),
    has_print_settings: Boolean(printSettings),
    has_cash_snapshot: Boolean(cashSummary),
    has_latest_closing: Boolean(latestClosing),
    storage_persistent: storage.persistent,
    storage_remaining_bytes: storage.remaining,
    entitlement_status: entitlement.status,
    entitlement_expires_at: entitlement.expiresAt ?? null,
  };
  await offlineDb.sync_meta.put({
    key: preparationKey(tenantId, branchId),
    tenant_id: tenantId,
    branch_id: branchId,
    value: report,
    cached_at: preparedAt,
  });
  progress('done', report.complete ? 'اكتملت تهيئة البيانات الأساسية' : 'اكتملت التهيئة مع بيانات تتجاوز حد التحميل؛ راجع التنبيه');
  return report;
}
