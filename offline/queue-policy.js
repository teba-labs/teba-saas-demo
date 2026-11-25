import { assertOfflineEntitlement } from './entitlement.js';

/** Central queue policy keeps the Outbox lifecycle independent of subscription details. */
export async function assertQueueAllowed(scope) {
  return assertOfflineEntitlement(scope);
}
