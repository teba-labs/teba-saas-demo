# Patient portal lookup — server-side function

This function is intentionally server-side. It uses the Supabase service-role key only in the Edge Function environment; never copy that key into browser code.

## Required Edge Function secrets

- `SUPABASE_URL` — the TEST project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — the TEST project's service-role key, stored only as an Edge Function secret.
- `PORTAL_HASH_SECRET` — a random secret of at least 32 bytes used to HMAC lookup identifiers and IP addresses.
- `PORTAL_ALLOWED_ORIGINS` — comma-separated exact origins, for example `https://tebalabs.com,https://www.tebalabs.com`; set the final portal host before enabling CORS.

## Request

`POST /functions/v1/patient-portal-lookup`

```json
{"slug":"lab-slug","patientName":"Patient Full Name","visitNumber":"V-000123"}
```

Only the newest published report version is returned. The URL expires after 120 seconds. Failure responses do not reveal whether a patient, visit, or report exists.

## Security notes / limitations

- Lookup requires tenant slug + exact normalized patient name + exact visit number.
- Rate limit: 5 attempts per lookup tuple and 20 per source IP per tenant in a rolling 15-minute window.
- Attempts are stored as HMAC hashes; raw names, visit numbers, and IPs are not written to the attempts table.
- This is an initial rate limiter using database counts. Before public launch, add an atomic database-backed limiter or managed edge rate limiting to avoid concurrent-request races, and verify the proxy IP header behavior for the deployed Supabase region.
- This function is source code only. It has not been deployed or live-tested against the TEST project.
