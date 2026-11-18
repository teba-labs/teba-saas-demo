import { syncOutbox } from './outbox.js';
import { createSupabaseSyncHandlers } from './supabase-adapters.js';

/** Best-effort background sync while an authenticated branch screen remains open. */
export function startBackgroundSync({ tenantId, branchId } = {}) {
  let stopped = false;
  const run = async () => {
    if (stopped || globalThis.navigator?.onLine === false) return;
    try { await syncOutbox({ handlers: createSupabaseSyncHandlers(), tenantId, branchId }); } catch { /* retained operations remain visible in Sync Center */ }
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
