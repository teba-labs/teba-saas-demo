# Offline entitlement activation (owner-only)

The signed offline entitlement engine is implemented, but it is intentionally **not activated** until the owner provisions the signing key. The repository contains no private signing key.

## 1. Generate the key pair on a trusted owner machine

From the repository root:

```bash
node scripts/generate-offline-entitlement-key.mjs
```

The script:
- writes only the public JWK into `offline/entitlement-public-key.js`;
- prints the private JWK and key ID to the terminal.

Do not paste the private JWK into chat, issues, pull requests, source files, or a committed `.env` file. Keep it in a password manager or transfer it directly into Supabase Edge Function Secrets.

## 2. Provision Supabase Edge Function Secrets

In the **intended runtime Supabase project**, set:

- `OFFLINE_ENTITLEMENT_PRIVATE_JWK` — the private JWK printed by the generator;
- `OFFLINE_ENTITLEMENT_KEY_ID` — the matching key ID printed by the generator.

The public JWK is not secret. Commit the generated `offline/entitlement-public-key.js` change only after confirming it contains the public JWK and no private material.

The issuer also requires the standard Supabase Edge Function environment values for the project URL, publishable/anon key and service-role/secret key. Never put the service-role key in browser code.

## 3. Deploy the Edge Functions

After reviewing the target project and confirming it is not an unintended production deployment:

```bash
supabase functions deploy issue-offline-entitlement
supabase functions deploy record-local-delivery
```

Do not deploy from this draft PR to the primary project without a separate deployment authorization. The current implementation has not been deployed by this work.

## 4. Manually activate a subscription

The issuer reads the latest subscription record for the tenant. Until a subscription-management UI exists, the owner manages that record manually using the existing subscription tables and a valid plan. Do not create or alter the `Taiba` user-testing tenant's subscription just to test this code.

A valid active/trial subscription must have a valid start/end window. The issued offline lease is bounded by the subscription window plus the configured grace period and never exceeds 35 days.

## 5. Activate and verify one prepared device

1. Sign in online as the intended tenant user.
2. Select the intended branch and run branch preparation.
3. From Sync Center, request/refresh the offline entitlement.
4. Confirm the status is valid and the device identity is bound to the expected tenant, branch, user and browser key.
5. Disconnect the network and verify that the already prepared session can be restored.
6. Do not treat a successful token issuance as proof of tenant/branch isolation; the owner must still perform the separate runtime acceptance test.

## 6. Expiry behavior

After the signed lease expires, new offline queued operations are blocked. Existing records remain readable/exportable and already queued operations remain eligible for synchronization when connectivity returns. Final publication, patient portal delivery and WhatsApp remain online-only.

The device identity and non-extractable private CryptoKey are not included in portable local backups. A restored backup on another device must be provisioned and authenticated separately.
