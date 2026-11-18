> **تحديث الحالة — 18 نوفمبر 2026:** هذا السجل يحتوي تاريخًا لدفعات قديمة، وليس بيانًا حاليًا بما نُفذ في قاعدة TEST. أداة Supabase أعادت سجل migrations فارغًا، وجدول `public.schema_migrations` يحتوي baseline `1.0.0` فقط، بينما توجد في قاعدة TEST فعليًا دوال ومحفزات لاحقة من وظائف الزيارات والنتائج والتقارير والتحصيل والمصروفات. كما توجد دالتان غير ممثلتين في migrations الحالية: `consume_patient_portal_attempt` و`set_branch_test_price`.
>
> لا تستنتج من عبارة قديمة أن Migration 008 أو 010 غير مطبقة، ولا تعِد تنفيذ 002–011. يجب أولًا مطابقة كل migration مع الكائنات الفعلية في TEST وتوثيقها. نسخة `patient-portal-lookup` المنشورة أحدث من ملف GitHub، ونسخة `publish-report` مطابقة للمصدر.
>
> الحالة التفصيلية في [التقرير الشامل](FUNCTIONAL-AUDIT-CONSOLIDATED-AR-2026-11-18.md) و[سجل الحالة الرئيسي](MASTER-STATUS-AND-CONTINUATION-AR.md).
>
> ---
>
# Migration status

## Completed foundations
- Source inventory and static audit.
- Isolated development copy with original source preserved.
- TEST Supabase URL and publishable browser key are configured in `config/environment.js`.
- Supabase client factory, Auth helpers, tenant/branch context and centralized schema contract.
- Dexie v4 local database and Outbox acknowledgement/retry/conflict foundation.
- Catalog repository: tests, current prices, parameters and test maintenance.
- Reception repository: branch-scoped patient lookup/creation, open-workday visits, visit tests, billing and RPC-based payment.
- Expense category read and RPC-based expense recording.

## Tests run
- `core-config.test.mjs` — PASS.
- `offline-contract.test.mjs` — PASS.
- `repository-contract.test.mjs` — PASS.
- JavaScript syntax checks are run separately for all authored modules.

## Not yet verified
- Browser login against TEST Supabase.
- Actual RLS behavior across two tenants and multiple branches.
- Live RPC argument compatibility against deployed database.
- Offline replay with real network interruption and duplicate retries.
- Full workflows wired to the UI.

## Next
- Laboratory and results repositories with immutable publication/correction history.
- Reports and patient portal access layer.
- Dashboard/financial summaries and CMS/settings modules.
- Wire UI pages only after each data contract is verified.
- Laboratory queue/status repository.
- Draft result entry, required-parameter completion checks and visit approval repository.

## Batch 5 added
- Report-version history and signed download foundation; publication deliberately blocked pending atomic server workflow.
- Tenant lab settings repository.
- Branch staff directory repository.
- Branch operational dashboard and expenses read repositories.

## Security-critical pending work
- Patient portal must be implemented as a rate-limited Edge Function with uniform failure responses; never expose patient/visit direct reads to `anon`.
- Publication/correction must be a server transaction covering PDF object, immutable report version, visit status and audit record.
- Monthly financial analytics must reconcile payments and expenses/ledger, not invoice gross/net amounts.

## Batch 6 added
- CMS settings and tenant-scoped content repository for all current website CMS collections.
- Public website data resolver/loader through the published tenant slug RPC and public RLS policies.
- Visibility controls avoid hard deletion and keep website branch visibility separate from operational branch activation.

## Batch 6 verification boundary
- Static tests only; no browser, authenticated owner, anonymous public, upload, or live RLS test has been performed.

## Batch 7 update — 2026-11-17
- Added patient portal page + anonymous Edge Function source + hardening migration 002.
- Added static patient-portal contract tests; all 13 static tests pass.
- No live Edge Function deployment or Supabase integration test has been performed. Deno is not installed in this workspace, so the Edge Function received static review only.
- Next: atomic server-side report publication/correction workflow, then wire authenticated staff screens.

## Batch 11 — workday cash control
- Added a separate open/close workday UI, expense entry and ledger summary.
- Migration 005 adds workday links to payments/expenses and changes new cash movements to use the manually open workday date, including after midnight.
- Updated the atomic reception RPC so the first payment is assigned to the visit's open workday.
- Static suite: 36 passing. Migration execution and live Supabase/RLS/concurrency tests remain pending.

## Batch 15 — offline synchronization and local backup foundation
- Added service-worker app shell caching, local cache for branch context/staff/workday/catalog/prices/parameters/ledger, and a scoped Sync Center.
- Outbox now supports stable operation IDs, dependencies, stale-lease recovery, cross-tab lock coordination, explicit acknowledgements and manual retry of terminal failures.
- Added server-side idempotent visit intake receipt migration 007, with expected-price validation to prevent silent repricing after offline delay.
- Added queue adapters for patient create, visit intake, payment and expense.
- Added SHA-256 checked local-device backup/restore, tenant/branch validation and transactional merge.
- Static suite: 63 passed, 0 failed. Syntax checks passed.
- Still not verified: migration execution, live RLS, multi-device offline replay, duplicate retries, price-change conflict and real browser backup restore.
- Important boundary: this batch does not yet provide full cloud backup/restore. Results entry, completion, approval and report publication/correction remain online-only pending their own idempotent server workflows.

## Batch 16 — integration entry point
- Added unified Arabic RTL launcher and role-aware navigation visibility.
- Added home links across screens and expanded service-worker shell to all app modules.
- Static suite: 67 passing; syntax and relative-path checks clean; original source manifest matches 31/31.
- Still required: apply migrations 001–007 to TEST, configure TEST key, run live authentication/RLS and two-tenant isolation tests, test offline replay/restore, deploy and test Edge Functions, and implement/test complete cloud backup/restore.

## Batch 19 — atomic catalog price updates (migration prepared, not applied)
- Added migration `008_atomic_catalog_price_update.sql` with a single owner-checked RPC to close the previous current price and insert the next current price in one database statement/transaction.
- The function locks the tenant-scoped catalog test row to serialize concurrent price changes for the same test, validates the amount, uses `SECURITY INVOKER` behavior (not `SECURITY DEFINER`), and retains table grants/RLS as an additional enforcement layer.
- Catalog repository now calls the centralized RPC contract and validates the returned row before refreshing the local current-price cache.
- Added static tests for owner enforcement, row locking, atomic write path, RPC grants, and removal of the two-request client sequence.
- Migration is a reviewed source artifact only: it has NOT been run on TEST or production. Live owner/staff/RLS/concurrency verification remains pending.

## Batch 20 — catalog integration hardening
- Fixed duplicate tenant-change event handling and stale asynchronous catalog/parameter responses.
- Made local current-price cache replacement transactional in IndexedDB.
- Static suite: 86 passed. Authored JS syntax: 34/34. Original-source manifest: 31/31.
- Browser runtime attempt timed out; no browser runtime result is claimed.
- Migration 008 remains unapplied; no Supabase or deployment activity.

## Batch 21 — result value-type integration
- Results UI now renders numeric, text, boolean and catalog-choice controls from each visit's immutable technical snapshot.
- Client validation rejects invalid boolean and choice values; catalog choice definitions are non-empty unique strings.
- Prepared migration 009 strengthens the server trigger to reject non-finite numeric results, invalid boolean values, and values outside the frozen choice list.
- Static suite: 90 passed. Migration 009 has NOT been applied; no live API or browser verification and no deployment.

## Batch 22 — results workflow and migration-chain audit
- Revalidated the Batch 21 archive and reviewed the end-to-end result-type path, report correction path, and migration ordering through 009.
- Confirmed migration 001 creates the `test_results` validation trigger and migration 009 replaces its function in place; frozen visit snapshots include the expected `value_type`, `reference_ranges`, and `choices` keys.
- Confirmed the published-result correction updates are subject to the same validation trigger.
- Added three static regression checks for trigger continuity, snapshot compatibility, and correction-path validation.
- Static suite: 93 passed, 0 failed; authored JS syntax: 34/34; original-source manifest: 31/31 hashes match.
- No source workflow or SQL migration was changed in this batch. No SQL execution, live Supabase/Storage/Edge Function test, browser runtime test, or deployment was performed.
- Known limitation for next pass: multi-parameter draft saving issues separate requests and can partially succeed; consider a database-atomic batch-save workflow.

## Batch 23 — atomic draft result save (migration prepared, not applied)
- Replaced the workbench's per-parameter request loop with one batch repository call for all non-empty values in a test.
- Added `save_draft_results_atomic` in migration 010. It checks authenticated branch access and active branch staff, locks the visit and visit-test rows, rejects published visits and duplicate parameter codes, and upserts the submitted rows in one transaction.
- Existing database triggers remain responsible for validating each value against the immutable visit snapshot and preventing unauthorized published-result mutation. A failure in any row aborts the full SQL function transaction.
- Added static regression tests for one-call UI behavior, RPC scope, authorization guards, and transaction path.
- Static suite and syntax checks are recorded in `docs/batch-23-test-run.txt`.
- Migration 010 is a source artifact only: it has NOT been applied to TEST or production. Live rollback/authorization/concurrency tests, SQL execution, browser runtime, and deployment remain pending.
