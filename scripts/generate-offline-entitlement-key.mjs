#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const keyId = 'taiba-offline-es256-v1';
const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { format: 'jwk' },
  privateKeyEncoding: { format: 'jwk' },
});
const publicJwk = {
  kty: publicKey.kty,
  crv: publicKey.crv,
  x: publicKey.x,
  y: publicKey.y,
  ext: true,
  key_ops: ['verify'],
};
const source = `/** Generated public verification key. Never add the private JWK here. */
export const OFFLINE_ENTITLEMENT_KEY_ID = ${JSON.stringify(keyId)};
export const OFFLINE_ENTITLEMENT_PUBLIC_JWK = Object.freeze(${JSON.stringify(publicJwk, null, 2)});
`;
writeFileSync(new URL('../offline/entitlement-public-key.js', import.meta.url), source, { mode: 0o600 });
process.stdout.write([
  'Public key written to offline/entitlement-public-key.js. Commit that file to the development branch.',
  '',
  'Set this exact secret in Supabase Edge Function Secrets (do not commit it):',
  'OFFLINE_ENTITLEMENT_PRIVATE_JWK=' + JSON.stringify(privateKey),
  '',
  'Keep a secure backup of the private key. Never paste it into GitHub, source code, or chat.',
].join('\n') + '\n');
