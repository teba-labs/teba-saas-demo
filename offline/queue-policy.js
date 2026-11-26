import { assertOfflineEntitlement, isOfflineEntitlementBypassed } from './entitlement.js';

/**
 * Commercial offline entitlement is temporarily bypassed for development.
 * Tenant/branch scope remains mandatory in enqueueOperation and all server
 * authorization/RLS checks remain unchanged.
 */
export async function assertQueueAllowed(scope) {
  if (isOfflineEntitlementBypassed()) {
    if (!scope?.tenantId || !scope?.branchId) throw new Error('tenantId and branchId are required for offline operations.');
    return { mode: 'development-bypass', tenant_id: scope.tenantId, branch_id: scope.branchId };
  }
  return assertOfflineEntitlement(scope);
}
