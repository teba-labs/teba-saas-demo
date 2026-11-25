/**
 * The public half of the ES256 entitlement key is pinned in the client.
 * Generate the key pair with scripts/generate-offline-entitlement-key.mjs.
 * Commit only the public JWK here. The private JWK belongs in Supabase Edge
 * Function Secrets as OFFLINE_ENTITLEMENT_PRIVATE_JWK and must never enter Git.
 */
export const OFFLINE_ENTITLEMENT_KEY_ID = 'taiba-offline-es256-v1';
export const OFFLINE_ENTITLEMENT_PUBLIC_JWK = null;
