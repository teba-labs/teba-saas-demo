import { syncOutbox } from './outbox.js';
import { createSupabaseSyncHandlers } from './supabase-adapters.js';
import { refreshOfflineEntitlement } from './entitlement.js';

/** Best-effort background sync while an authenticated branch screen remains open. */
export function startBackgroundSync({ tenantId, branchId } = {}) {
  let stopped = false;
  let refreshingEntitlement = false;
  const run = async () => {
    if (stopped || globalThis.navigator?.onLine === false) return;
    if (!refreshingEntitlement) {
      refreshingEntitlement = true;
      try {
        await refreshOfflineEntitlement({ tenantId, branchId });
        globalThis.dispatchEvent?.(new CustomEvent('taiba:offline-entitlement-updated', { detail: { tenantId, branchId } }));
      } catch (error) {
        globalThis.dispatchEvent?.(new CustomEvent('taiba:offline-entitlement-error', { detail: { tenantId, branchId, message: error?.message || String(error) } }));
      } finally {
        refreshingEntitlement = false;
      }
    }
    // Entitlement expiry never blocks synchronization of work already queued.
    try {
      const report = await syncOutbox({ handlers: createSupabaseSyncHandlers(), tenantId, branchId });
      if (report.acknowledged > 0) globalThis.dispatchEvent?.(new CustomEvent('taiba:offline-sync-complete', { detail: report }));
    } catch { /* retained operations remain visible in Sync Center */ }
  };
  const onOnline = () => run();
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  globalThis.addEventListener?.('online', onOnline);
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);
  const interval = globalThis.setInterval?.(run, 30_000);
  run();
  return () => {
    stopped = true;
    globalThis.removeEventListener?.('online', onOnline);
    globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
    if (interval) globalThis.clearInterval?.(interval);
  };
}
