# Supabase v1 contract — development target

- Project URL: `https://hgqwpykeazuzceeiumjg.supabase.co`
- Project ref: `hgqwpykeazuzceeiumjg`
- This is the TEST project. The production project `khjzoleiuiipyodpkieg` is not used by this workspace.
- Browser code must use only the TEST project's publishable/anon key. Never use `service_role` or any secret key in frontend files.
- The publishable key was not present in the source package or supplied project files. It must be copied from the TEST project's Supabase API settings into `config/environment.js` before browser connection tests.

## Authorization contract

- User identity comes from Supabase Auth session.
- Tenant membership comes from `tenant_memberships` for `auth.uid()`.
- Branch access comes from `branch_memberships`; tenant owners may see all active tenant branches under RLS.
- `localStorage`, URL parameters, and client-supplied tenant/branch IDs are never authorization evidence.
- RLS remains the security boundary. Client filtering is presentation only.

## Important schema differences from legacy UI

Legacy `users` is not a table in schema v1.0. Use `tenant_memberships`, `branch_memberships`, and `staff_directory`.
Legacy `offers` maps to `site_offers`.
Legacy `patients.name` maps conceptually to `patients.full_name`; other patient and visit fields require explicit mapping to schema v1.0.
Legacy visits no longer carry all billing fields: billing and payments are separate tables.
Legacy result JSON is not equivalent to normalized `test_results` rows and report versions.

Do not connect legacy pages directly to this schema until each module has a tested repository adapter.
