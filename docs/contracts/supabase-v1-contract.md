# Supabase v1 contract — primary runtime target

## Project roles (authoritative mapping, 21 November 2026)

- **Primary runtime / existing Taiba SaaS project:** `https://hgqwpykeazuzceeiumjg.supabase.co`, ref `hgqwpykeazuzceeiumjg`, dashboard name `teba-lis-demo`.
- **Reserved TEST project:** ref `khjzoleiuiipyodpkieg`, dashboard name `teba-lab`. This project has a different, older schema and is not the live application's database.
- The earlier documentation incorrectly described the SaaS project as TEST and the other project as production. This mapping supersedes those labels.
- The deployed app must remain connected to the existing primary SaaS project. Keep its current project URL and publishable browser key unchanged unless a separately reviewed connection change is explicitly planned.
- This repository's browser code must use only the primary project's publishable key. Never use `service_role` or any secret key in frontend files.
- The reserved TEST project is not yet verified as schema-compatible with the current SaaS app. Do not point the app at it, apply the full SaaS migration chain to it, or assume it is ready for testing until its schema, policies, functions, storage and test identities are deliberately prepared.
- This role correction does not migrate data, apply database migrations, deploy Edge Functions, change secrets, or change Storage configuration. Cloud-function URLs/secrets remain a separate follow-up task.

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
