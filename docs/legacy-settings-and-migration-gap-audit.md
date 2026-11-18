# Legacy settings and migration gap audit

Date: 2026-11-18
Scope: read-only inspection of `teba-labs/teba-lab` (main) and SaaS development branch `cloud-hardening-2026-11-18`.
No legacy files, production data, tenant records, credentials, or database policies were changed.

## 1. Legacy system settings: `system/settings.html`

Verified UI areas and functions:
- Lab identity: Arabic/English lab name, doctor name, phone, WhatsApp, address, logo, primary color.
- Branch management: list/add/edit/delete branch, including a legacy `branch_password` field.
- Employees and permissions: list/add/delete employee; legacy creation calls `create_employee` RPC.
- Expense categories: list/add/delete.
- Print/report settings: branch names/addresses, phone numbers, report header/footer, doctor signature upload.
- Data export: date-scoped export of visits with linked patient data.
- Legacy import: CSV/XLS/XLSX reader, column mapping for patient name, age, gender, visit date, test name, result, reference range, then inserts rows into `historical_results`.
- Audit log: reads recent audit records.

Legacy tables/storage referenced include `site_settings`, `tenants`, `branches`, `expense_categories`, `visits`, `historical_results`, `audit_logs`, `users`, and the `lab-assets` bucket.

### Important legacy import limitation
The old importer reads only the first worksheet of an Excel workbook and writes flattened rows into `historical_results`. It does not recreate the relational chain of patient -> visit -> requested tests -> result versions -> payments/debts. It also has no import-batch idempotency key, resumable checkpoint, or duplicate preview. Therefore it is not safe or sufficient as the SaaS migration mechanism.

### Security behavior not to copy
The old branch editor stores a branch password-like value in the `branches` row. The new SaaS model must continue using authenticated users, memberships, branch assignment, and RLS; never migrate or recreate plaintext branch passwords. Employee provisioning must use a secure, owner-authorized server/RPC flow and must not expose passwords in browser-side tables or logs.

## 2. Legacy website settings: root `settings.html`

Verified CMS areas:
- Packages
- Medical articles
- FAQs
- Testimonials
- Offers
- Website-visible branch details

Legacy tables referenced: `site_packages`, `site_articles`, `site_faqs`, `site_testimonials`, `offers`, and `branches`, all queried with a tenant filter in the page code. The old page has add/edit/delete flows for these content types.

## 3. SaaS replacement already present

### Owner settings center
- `app/settings.html` + `assets/js/settings-center.js` + `modules/settings/repository.js`
- Authenticates through the current session and loads tenant context.
- Filters tenant choices to `accountType === 'owner'`.
- Reads/writes `lab_settings`: laboratory name, doctor, phone, WhatsApp, address, report footer, WhatsApp template, logo path and JSON settings.
- Shows branch names/addresses and subscription status.
- Links to catalog, financial dashboard, CMS, sync center, workday, and operations.
- Branches are currently display-only here; the page itself says branch and employee management will be added after permission controls are complete.
- `getPrintSettings` exists in the settings repository, but this page currently does not expose print settings UI.

### Website CMS
- `app/cms-editor.html` + `assets/js/cms-editor.js` + `website/cms-repository.js`
- Has owner login and tenant context.
- Supports sections, displayed tests, packages, articles, FAQs, testimonials, offers, and website branch profiles.
- Uses tenant-scoped reads/writes and RLS as the authorization boundary.
- Supports public content JSON, theme JSON, and publication toggle.
- This is a more structured tenant CMS than the old page; it uses `site_offers` and `site_branch_profiles` rather than the legacy `offers` and direct branch display fields.

### Existing SaaS foundations
The initial schema already includes `lab_settings`, `print_settings`, `expense_categories`, `branches`, `branch_memberships`, `staff_directory`, `site_settings`, `site_packages`, `site_articles`, `site_faqs`, `site_testimonials`, `site_offers`, and `site_branch_profiles`.
The relational patient/visit/result/billing/payment model exists in the SaaS schema, so migration should populate that model rather than flattening all history into `historical_results`.

## 4. Concrete gaps to close

1. **System settings parity:** branch add/edit/deactivate; employee invitations/provisioning and role/branch permissions; expense-category management; print/report settings and logo/signature assets; owner-facing audit log; safe data export.
2. **Website CMS parity and mapping:** confirm every legacy content field maps into the SaaS content tables; explicitly map legacy `offers` to `site_offers`, and public branch details to `site_branch_profiles`; migrate content without publishing it automatically.
3. **Tenant settings initialization:** verify the existing Taiba tenant already has its required `lab_settings`, `site_settings`, and default `print_settings` rows. Do not create another tenant or overwrite current values blindly.
4. **Data migration:** build a separate staged importer for all workbook sheets and supported legacy exports. It must preview sheet/column mapping, preserve relationships, detect likely duplicate patients without auto-merging, use stable source identifiers/idempotency, checkpoint batches, report row-level errors, and support safe retry/rollback strategy.
5. **Asset migration:** logo, signature, site images, and published reports need an explicit private/public destination and tenant-scoped metadata; do not copy legacy public URLs blindly.
6. **Owner experience:** final acceptance must be performed using the Taiba lab-owner account, not the platform administrator account.

## 5. Recommended next implementation order

A. Inspect current Taiba tenant settings rows and existing CMS/editor behavior read-only.
B. Complete system settings controls against existing SaaS tables and secure RPCs, without changing schema until a gap is proven.
C. Design and implement a dry-run migration manifest and preview first; test with synthetic/de-identified data.
D. Only after reconciliation and explicit approval, run a real Taiba migration. Do not import identifiable patient data into TEST as a convenience test.
E. Sign in as Taiba lab Owner and verify settings, branches, staff, printing, content, export, and operational workflows.

## 6. Explicitly not done in this audit

- No writes to the legacy repository or legacy Supabase project.
- No tenant/branch/subscription creation or mutation.
- No schema migrations, RLS changes, storage policy changes, or deployment.
- No real patient data import.
- No claim that the full end-to-end settings or migration workflows have passed.
