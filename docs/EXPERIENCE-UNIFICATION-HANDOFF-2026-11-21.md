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
| 2. UI/cloud integration review | In progress | Trace repository/service imports and page entry points. |
| 3. Results save validation | In progress | Confirm generic vs culture-only cases; add regression tests. |
| 4. Full report lifecycle | Pending | Verify preview/print/publish/WhatsApp gating and data source. |
| 5. Persistence/sync | Pending | Inspect outbox, retry, idempotency and read-after-write. |
| 6. Sync repair | Pending | Fix only demonstrated defects. |
| 7. Global/per-page themes | Pending | Add persistent global default plus per-page override. |
| 8. Keyboard navigation | Pending | Ensure Enter submit, Tab order, list arrows and native input behavior. |
| 9. Design tokens | Pending | Define shared tokens and component states. |
| 10. Page-specific redesign | Pending | Apply shared visual language without changing clinical workflows. |
| 11. Login/logout/navigation | Pending | Harmonize all entry points and sign-out behavior. |
| 12. TAIBA TECH identity | Pending | Apply platform-company identity in platform-owned surfaces. |
| 13. TAIBA SMART LAB identity | Pending | Apply product identity in tenant application surfaces. |
| 14. Platform/tenant separation | Pending | Audit schema, settings and RLS before changing ownership model. |
| 15. Tenant/branch isolation | Pending | Preserve and test RLS boundaries. |
| 16. Automated tests | Pending | Run repository CI and add targeted regressions. |
| 17. Responsive/performance | Pending | Static review and CI; browser QA boundary recorded. |
| 18. Integrated preview | Pending | Keep preview on the development branch. |
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
