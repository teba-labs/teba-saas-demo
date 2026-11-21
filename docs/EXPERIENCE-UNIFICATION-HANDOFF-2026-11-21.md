# TAIBA TECH / TAIBA SMART LAB — Experience Unification Work Log

Date: 2026-11-21
Working branch: `feature/experience-unification-2026-11-21`
Safety branch: `backup/pre-experience-unification-2026-11-21`
Starting baseline: `feature/results-workbench-final-2026-11-21`
Main is not modified. No PR merge or production/TEST migration is authorized by this work log.

## User-authorized scope
One integrated development cycle covering all 20 work items:
1. Inspect every system page and file.
2. Inspect page/module/cloud-service integration.
3. Fix the false "enter at least one result" save validation.
4. Verify visit flow: registration → results → save → preview → print → publish → WhatsApp.
5. Verify result persistence and local/cloud synchronization, including duplicate/loss protection.
6. Repair identified sync/retrieval issues.
7. Implement global and per-page light/dark appearance preferences.
8. Repair keyboard navigation and Enter/Tab/arrow behavior end-to-end.
9. Establish a consistent visual system.
10. Improve page-specific layouts without flattening workflows.
11. Unify login/logout/navigation.
12. Platform company identity: TAIBA TECH.
13. Product identity: TAIBA SMART LAB.
14. Separate platform-owner identity/settings from tenant laboratory data.
15. Preserve tenant/branch/RLS isolation.
16. Run automated tests for critical workflows.
17. Review responsive behavior and performance.
18. Prepare one integrated preview build.
19. Produce a truthful test and remaining-risk report.
20. Keep all work on development branch and prepare review; do not merge to main without separate explicit approval.

## Initial verified repository state
- The results workbench development baseline is `feature/results-workbench-final-2026-11-21`.
- A safety branch and a dedicated work branch were created from that exact baseline before edits.
- Open PR #28 (preprinted letterhead) and PR #29 (owner financial archive) remain separate and untouched.
- No production data or Supabase migrations have been changed by this cycle.

## Initial code findings (inspection only; not yet a confirmed root-cause diagnosis)
- `assets/js/results-workbench.js` gathers generic result values only from non-calculated controls matching `[data-param-code]`, then throws the red "أدخل نتيجة واحدة على الأقل قبل الحفظ" message when that collection is empty.
- Culture isolate and antimicrobial-susceptibility forms are persisted by separate `saveCultureIsolate` / `saveCultureSusceptibility` handlers.
- The generic Save Results control is currently rendered in the generic test markup even when the test has no generic parameter controls. This can expose the wrong save action for culture-only or parameterless test records. Confirm and correct this without weakening required-result validation.
- `modules/results/repository.js` writes generic result batches through the tenant-scoped atomic RPC `save_draft_results_atomic`; preserve this atomic path and its tenant/branch scope.
- `modules/ui/keyboard-navigation.js` is shared but only included on selected pages. Its current Enter behavior advances focus rather than submitting the final login field in one action; review carefully to avoid breaking native controls.
- Several inspected page heads declare `color-scheme: light`; no consistent page-level appearance controller was found in the inspected files.

## Work ledger
| Item | Status | Evidence / next action |
|---|---|---|
| 1. Full page/file inventory | In progress | Map all application, portal, owner and platform pages. |
| 2. UI/cloud integration review | In progress | Confirmed results save uses atomic Supabase RPC; preview/publish use cloud repositories/storage. Broader all-page audit remains. |
| 3. Results save validation | Code fix committed | Confirmed selector bug: `closest('[data-test-id]')` selected the save/correction button itself because it also carries `data-test-id`. Both actions now select `.parameter[data-test-id]`; regression test added. CI/browser retest pending. |
| 4. Full report lifecycle | Partially traced | Preview reads cloud-backed report data; publish requires approved visit, prior preview and PDF upload; WhatsApp opens a prefilled patient-portal link only after publication. Browser/PDF/WhatsApp acceptance still pending. |
| 5. Persistence/sync | Pending | Inspect outbox, retry, idempotency and read-after-write. |
| 6. Sync repair | UX guard added | Results screen now clearly rejects cloud-only actions while offline; do not queue clinical results until a safe server-side idempotent/atomic sync design exists. Broader sync defects remain to audit. |
| 7. Global/per-page themes | Implemented in branch | Added persistent global default and page overrides, scope selector, dark/light stylesheet, and loaded controller on 12 product/platform/portal pages. CI and browser QA pending. |
| 8. Keyboard navigation | Code updated | Final text/password field now submits with Enter; search/select native behavior preserved; arrow list navigation retained. Keyboard module loaded on all 12 pages. CI/manual QA pending. |
| 9. Design tokens | Partial implementation | Added shared color tokens, card/control/focus/hover states, common header and page-frame styling. Page-by-page visual refinement remains. |
| 10. Page-specific redesign | Partial implementation | Ported the 18-report owner dashboard card navigation and its responsive card/screen styles; added dark-mode styling for owner reports and financial import. Other pages still need visual review. |
| 11. Login/logout/navigation | In progress | Keyboard submit and appearance controls added to all product/platform/portal entry points. Full logout/navigation audit remains. |
| 12. TAIBA TECH identity | Implemented in platform entry | Platform admin header/title now identify TAIBA TECH with Software Development & Digital Solutions descriptor. |
| 13. TAIBA SMART LAB identity | Implemented in tenant branding | Tenant branding now preserves TAIBA SMART LAB as product identity and shows laboratory name separately. |
| 14. Platform/tenant separation | Existing UI boundary confirmed; RLS audit pending | Platform admin UI uses aggregate tenant metrics and does not render patient names, visit-level records, results or report files. No ownership schema changed. Verify RPC/RLS policies before completion. |
| 15. Tenant/branch isolation | Pending verification | Existing outbox filters and result RPC inputs are tenant/branch scoped; RLS policy review and isolated-tenant tests remain mandatory. |
| 16. Automated tests | Added; execution pending | Added regression coverage for result selector, page theme/keyboard loading, offline assets and brand separation. CI status had not reported when last queried. |
| 17. Responsive/performance | Partial | Added responsive control/header rules; full responsive/performance review remains. |
| 18. Integrated preview | Draft review target only | Draft PR #31 created; GitHub reports it is not mergeable because the development baseline diverges from main. It is not a deployable preview. |
| 19. Final evidence report | Pending | Record exact CI run and manual-test limitations. |
| 20. Review handoff | Pending | Open review PR only after implementation and checks; do not merge. |

## Change log
### 2026-11-21 — Cycle initialization
- Created `backup/pre-experience-unification-2026-11-21` from the results-workbench baseline.
- Created `feature/experience-unification-2026-11-21` from the same baseline.
- Inspected results UI, generic save repository, culture workflow, keyboard module, and home/reception page entry points.
- No application code changed yet.

### Baseline synchronization attempt
- Compared the results-workbench baseline with `main`: histories are divergent (122 commits unique to the development baseline and 4 main-only commits).
- Opened PR #30 to merge main into the new development branch; GitHub reported it as not mergeable. It was closed without merging.
- This confirms the two branches have overlapping independent changes. Do not perform a blind merge or replace files wholesale. Keep the development baseline isolated while reconciling relevant main-only changes deliberately in later work.
- PR #28 and PR #29 remain open and untouched; main remains unchanged.

### 2026-11-21 — First implementation tranche
- Confirmed and fixed the false-empty result selector in both `saveTest` and `correctTest`: `button.closest('[data-test-id]')` returned the button itself because the action button also had that attribute. Changed both to `button.closest('.parameter[data-test-id]')`.
- Added a static regression test for the selector collision.
- Updated shared keyboard handling so Enter advances between text fields and submits the form from the final text field; native search/select behavior is no longer intercepted. Added tests.
- Added `assets/js/theme-controller.js` and `assets/css/theme-system.css`: persistent global light/dark preference plus page-specific override; per-page scope selection; common card, button, focus, header and dark-mode styling.
- Loaded theme controls across app home, reception, results, catalog, workday, sync center, dashboard, system settings, CMS editor, historical data import, platform admin and patient portal.
- Added keyboard module to patient portal; other app pages and platform admin already included it.
- Bumped service-worker shell cache to v28 and precached the theme controller and stylesheet.
- Separated product identity from tenant identity: tenant headers retain `TAIBA SMART LAB` and display the lab name separately. Platform admin title/header use `TAIBA TECH`.
- Added static test file `tests/static/experience-unification.test.mjs`.
- Added the working branch to the static-contract workflow push triggers.
- Relevant commits: result fix `151ba0d`; result regression `884e507`; keyboard `f71fea3`; theme controller `8c978a6`; theme stylesheet `50ad72f`; product/tenant brand `0f5d98e`; service worker `3e3df1e`; platform brand `320c37b`; test suite `c7ead58`; workflow trigger `8290747`; latest shared style commit `86345fc`.
- The static CI status query for the latest commit returned no checks yet. Do not claim tests passed until a run is confirmed.

### Cloud and offline boundary audit
- `saveDraftResults` calls the Supabase RPC `save_draft_results_atomic` with tenant, branch, visit-test and staff identifiers. It is a direct cloud write and is not added to the offline outbox.
- The outbox has handlers for `patients`, `visit_intake`, `payment`, and `expense`. It scopes candidate operations and lease recovery to the selected tenant and branch, uses operation UUIDs, dependency acknowledgements, retry limits and explicit conflict records.
- Result completion, approval, correction, preview and report publication are online/cloud-dependent. The UI now shows an explicit offline warning for the main clinical save/approval/preview/publication actions. This cycle does not pretend those clinical writes are safely queued offline.
- The report lifecycle is wired through separate modules: result repository → report preview builder → report publication/storage → patient portal. WhatsApp is a prefilled external handoff link; the app does not send a message autonomously.
- These are code-path findings only. They do not prove actual cloud permissions, RLS behavior, storage policies or browser acceptance.

### Draft review target
- PR #31: `https://github.com/teba-labs/teba-saas-demo/pull/31` (draft; base `main`; head `feature/experience-unification-2026-11-21`).
- GitHub reports PR #31 as not mergeable because the development branch and main have diverged. No merge was attempted.
- The last queried commit status returned no checks; CI is not yet confirmed. Do not mark the test suite as passing.
- PR #30 (main-to-development synchronization attempt) was closed without merge after GitHub reported conflicts.

### Report-to-portal handoff clarification
- The report preview is rendered in a separate browser window and has its own `طباعة التقرير` control.
- The publish action does not upload the preview window automatically. The user must print/save that preview as PDF, select the saved PDF in the report upload field, then publish it.
- Publication calls the `publish-report` Edge Function; the report repository uses the private `tenant-reports` storage bucket and creates signed URLs for authorized downloads.
- After publication, the results workspace enables a WhatsApp handoff only when the report is published, a valid Egyptian phone is available, and the tenant slug exists. It opens a prefilled `wa.me` draft pointing to the patient portal; the employee still reviews and sends the message in WhatsApp.
- The upload field now explains the required `Save as PDF` handoff instead of implying that preview and publication are one automatic step.
- Added a static contract test for the private report-storage and WhatsApp-to-portal wiring.
- Additional commits: PDF handoff clarification `3f60f4e`; PDF workflow test `8656e9e`; identity footer `13047b8`; identity test `4bea0b7`; appearance assertion correction `402aac9`; tenant branding test correction `92ec0f2`; report/WhatsApp wiring test `96408db`.

### Owner dashboard integration
- Ported the open PR #29 owner dashboard work into this development branch: 18 independent report screens/card navigation, live-today KPIs, financial-source selection, generic Excel financial import, historical archive integration, and associated repository/engine code.
- Added migrations 069–071 and their static/unit tests to the development branch. These migrations were previously applied to the TEST project only during PR #29 validation; no migration was applied by this current cycle, and production was not modified.
- Added the owner report card/screen CSS and dark-mode styling. Service-worker shell is now v29 and precaches the dashboard import modules.
- Updated the owner-dashboard static contract to expect shell v29 and to verify the 18-report card navigation.
- PR #29 itself remains open and untouched. Its code has been ported into this development branch, not merged into main.
- Key port commits: dashboard screen code `0ae712c`; dashboard history integration `823afcf`; financial import UI `584135e`; owner financial repository `c8b4352`; migrations 069/070/071 `4829bbe`, `dd16a21`, `0b3b2c1`; import engine `978821d`; financial tests `70ff3e3`, `9b97b24`; dashboard page `9a051d8`; dashboard CSS `3910247`; owner dashboard test `d5671c0`; dark dashboard styling `9d2d210`.

### Final integrated CI validation
- PR #32: `https://github.com/teba-labs/teba-saas-demo/pull/32`
- GitHub Actions run #1056 / run ID `44912980621`: **success**.
- JavaScript module syntax checks: passed.
- Browser-only deployment artifact build: passed.
- Static and unit regression suite: **261 passed, 0 failed**.
- Source archive artifact ID: `14710452028`.
- Source ZIP SHA-256: `044a49eec5c6026f131b5de4238fd755aeaeadfc404042f67540ad76539b43d1`.
- Artifact: `https://github.com/teba-labs/teba-saas-demo/actions/runs/44912980621/artifacts/14710452028`.
- The first CI run exposed five test failures: four stale v27 cache expectations and one incorrect theme-property assertion. Those were corrected; the successful run above is after the corrections.
- PR #32 is the clean main-based review branch. No merge into main has occurred.
- The original working branch and pre-cycle backup branches remain preserved.
