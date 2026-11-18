# Batch 7 — patient portal foundation

## Added
1. `portal/index.html` — Arabic responsive patient lookup page.
2. `portal/lookup.js` — calls the server-side function; no service-role key or direct patient-table query is present in browser code.
3. `supabase/functions/patient-portal-lookup/index.ts` — server-side tenant resolution, exact normalized patient-name + visit-number match, attempt logging, generic failure response, and short-lived signed URL for the newest published report.
4. `database/migrations/002_patient_portal_hardening.sql` — forces RLS and revokes browser-role access to portal attempt records; adds an IP/time index.
5. `tests/static/patient-portal.test.mjs` — static contract checks.

## Security behavior implemented in source
- The function requires a valid tenant slug, patient name, and visit number.
- Tenant status must be `trial` or `active`.
- Only published visits and published report versions are eligible.
- The latest version is selected by descending version number.
- PDF access uses a private Storage signed URL that expires after 120 seconds.
- Lookup and IP values are stored as HMAC hashes, not raw values.
- Initial limiter thresholds: 5 attempts per lookup tuple and 20 per source IP per tenant in 15 minutes.
- Failed lookup responses do not disclose whether the tenant's patient, visit, or report exists.

## Not done / not verified
- The Edge Function has not been deployed to the TEST Supabase project.
- Required secrets and final portal origins have not been configured.
- No live patient lookup or Storage signed-URL test has been run.
- The count-based limiter can race under concurrent requests; replace it with an atomic database RPC or managed edge rate limiting before public launch.
- Forwarded-IP header behavior must be verified in the deployed environment.
- Report publication and correction workflows remain intentionally unavailable.

## Validation
Static tests verify the expected source contracts only. They do not prove deployed security, RLS behavior, rate-limit effectiveness, or correct patient/report data in Supabase.

## Additional deployment configuration
- `supabase/config.toml` disables JWT verification only for this public lookup function. The function itself performs its own lookup checks and rate limiting; do not copy this setting to staff-only functions.
