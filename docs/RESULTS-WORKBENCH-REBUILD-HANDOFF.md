# Results Workbench Rebuild — Handoff & Acceptance Specification

**Repository:** `teba-labs/teba-saas-demo`  
**Working branch:** `integration/unified-test-2026-11-19`  
**Scope:** Rebuild the results workbench as a complete, operational workflow. This document is the durable source of truth for the agreed requirements. A future chat/developer must read this file and inspect the branch before asking the owner to repeat decisions.

## Owner's non-negotiable product direction

- Build for small, cost-conscious Egyptian independent laboratories. Do not imitate large hospital/LIS interfaces or introduce unnecessary enterprise complexity.
- Prioritize a clear, readable, practical interface. Fonts must be legible; colors must be coordinated with the rest of Taiba Smart Lab. Do not merely recolor the old cluttered screen.
- Preserve existing working functions and historical data. Do not claim completion based only on a visual mockup or buttons without real behavior.
- Keep work on the development branch; protect `main` until the owner has reviewed the live preview and approved the result.

## 1. Main screen layout

- The results workbench has **three side-by-side work columns**:
  1. Visits/patients.
  2. Individual tests.
  3. Profiles/grouped tests.
- Above all three columns, add one horizontal action bar for the selected visit:
  - Publish results to the patient portal.
  - Send results through WhatsApp only when a phone number exists and the report is eligible.
  - Hide/archive the case from the ordinary work list; allow restoration.
  - Any destructive-looking action must be a safe logical deletion/archive, not silent permanent destruction of the medical record.
- Selecting a visit loads its individual tests and profiles into columns 2 and 3.
- Keep the three-column navigation available. When a result-entry workspace opens, use a focused work area/modal/panel with a clear return-to-list action; do not make users lose their selected visit.
- Responsive behavior is required for the owner's phone and desktop. On narrow screens, columns may stack or become switchable tabs, but must remain understandable and usable.

## 2. Individual tests and profiles

### Individual tests
- Show every individual test registered at reception for the selected visit.
- One action opens **one combined result-entry/report workspace** containing all individual tests for that visit, regardless of count or parameter complexity.
- One combined individual report/print section covers all individual tests.

### Profiles / grouped tests
- Show the profiles registered at reception.
- Each profile opens its own separate result-entry workspace and separate report/print section.
- Example acceptance case: 5 individual tests + 8 profiles = 1 combined individual workspace/report + 8 separate profile workspaces/reports (9 report sections total).

### Add missing tests from results screen
- Each of columns 2 and 3 has its own matching catalog: individual catalog in column 2; profile catalog in column 3.
- Staff can add a forgotten test/profile without leaving the results workbench and returning to reception.
- Addition attaches to the currently selected visit and is reflected in reception/visit data as an added-after-registration item, with who added it and when.
- Prevent duplicates and handle concurrent/repeated clicks safely.
- Preserve the original reception registration; do not rewrite history as if the item was registered at the original reception time.

## 3. Result entry, reference ranges, history and audit

- Staff can save drafts, complete tests, approve visits, correct results when permitted, and see clear statuses (not started / in progress / saved / completed / approved / published as supported by the existing data model).
- Allow editing a reference range for an individual parameter directly while entering results; do not force the operator to leave the workbench and open test management.
- Separate three levels of data:
  1. Test catalog's current technical definition/range: applies to **new visits only**.
  2. Visit-specific snapshot: the range/technical metadata used for that visit is frozen for that visit.
  3. A correction made while entering or correcting a result: applies only to the selected visit and parameter/result, never to other visits or other parameters.
- Editing catalog values later must not mutate old visit snapshots.
- A patient may have multiple visits on different dates; each visit retains its own ranges and result values.
- Preserve before/after values, actor, timestamp, and correction reason where applicable.
- If a report was already issued, preserve the previously issued version and create a clearly identified corrected version; never silently overwrite the historical report.
- Parameter-level edits must not unintentionally change sibling parameters.

## 4. Report design and print settings

Design and approve the report template before connecting final preview/print/publish actions. Keep the template builder modular and shared across individual tests, profiles, and culture reports.

### Language and visual identity
- Test names, parameter names, results, units, reference intervals and scientific data are in English.
- Patient/lab/branch identity and explanatory administrative labels may be Arabic.
- Keep the visual identity simple and appropriate for an Egyptian neighborhood laboratory: clean white paper, coordinated Taiba colors, readable Arabic/English fonts, no expensive or multinational-corporate styling.
- Retain existing paper size/orientation/margins settings where available.

### Header: three zones (right / center / left)
- Right and left zones are configurable and can be swapped from Print Settings.
- One side contains the lab name and the general doctor/name shared across branches.
- The other side contains the corresponding configurable identity/text content.
- The center logo is stable in the center; allow selecting the general lab logo or the current branch logo from settings.
- Do not hardcode a single ordering; owner chooses which content appears right and left.

### Footer: three zones (right / center / left)
- Right zone: all branch addresses, each branch on its own line; support multiple branches (including five or more) without clipping.
- Left zone: selected phone numbers, WhatsApp contact(s), essential patient links, support link, and website link.
- Center zone is optional/configurable: QR code to the lab website is the preferred use; may instead contain a short message or be hidden/empty. Avoid redundant QR codes if one already appears elsewhere.
- If website/QR/contact data is absent, omit it cleanly; no empty placeholders.

### Branch identification
- Clearly print which branch performed the visit/tests. Pull the branch from the selected visit, not a default branch setting.
- Place a compact line in an appropriate report area (header or footer), e.g. Arabic equivalent of “Tests performed at: [branch name]”.

### Watermark
- Reserve and implement watermark support even though the current print settings may not yet expose it.
- Configurable choice: lab logo or lab name; opacity, size, and position should be adjustable.
- Watermark must remain subtle and behind report content, preserving readability.

### Footer and signatures
- Keep signature/stamp/reviewer area configurable and proportionate; do not waste paper with oversized empty sections.
- Support existing signature assets and lab/branch identity settings.

### Report grouping
- All individual tests: one combined report section/page flow.
- Each profile: its own separate report section.
- Culture reports retain culture-specific details, isolates, antimicrobial susceptibility, methods/standards, and notes.
- Do not lose any existing historical result selection behavior unless explicitly redesigned and preserved.

## 5. Visit preview, print, portal and WhatsApp

- Add a **Preview Visit Results** action before printing or publishing.
- Preview shows all report sections in order: combined individual report, then each profile separately, and culture sections as appropriate.
- Clearly identify incomplete/unapproved sections. Block final publishing of incomplete/unapproved results; do not silently publish partial work.
- Allow navigation between report pages/sections and review patient name, visit number/date, branch, ranges, units, flags, signature, watermark, header/footer.
- Print the reviewed output using the approved report builder.
- Portal publishing uses the existing report version/publishing workflow where possible; do not treat choosing/uploading an unrelated PDF as a substitute for the report preview/build process.
- WhatsApp action is available only when a valid phone number exists and only sends the eligible approved report/link. Use existing integration if present; if not, clearly document the integration dependency rather than showing a fake success button.
- Preserve every published version and correction history.

## 6. Case hide/archive and safe deletion

- Provide hide/archive from the normal work list, with restore.
- If a logical-delete option is implemented, require confirmation and reason where appropriate, retain records/results/audit trail, and enforce permissions.
- No permanent hard delete of patient history/results through an ordinary workbench button.

## 7. Existing capabilities to preserve and integrate

Inspect and retain working behavior for:
- Login, tenant/branch/staff selection and branch isolation.
- Paginated work list and refresh.
- Draft result saving, calculated parameters, test completion and visit approval.
- Published report versions and corrected results.
- Attachments and secure download links.
- Culture isolates and antimicrobial susceptibility records.
- Historical-result lookup (must remain clearly separate from current operational results).
- Lab branding assets, signatures, and print configuration.
- Existing keyboard navigation and responsive styles.

## 8. Required engineering and acceptance checks

Do not call the work complete until all applicable checks pass:
- Existing automated tests and build/static checks.
- Tests for individual combined entry/report and separate profile workspaces.
- Add-from-results behavior reflected in the correct visit/reception records, with audit trail and duplicate prevention.
- Catalog range changes affect new visits only; visit-specific range edits affect only that visit/parameter.
- Historical report version remains retrievable after correction.
- Preview accurately matches printed/published output.
- Publishing blocks incomplete/unapproved sections.
- WhatsApp action is genuinely integrated or clearly unavailable (never fake success).
- Hide/restore and logical-delete permission/audit behavior.
- Tenant/branch RLS and employee scoping remain intact.
- No regression in cultures, isolates, susceptibility, attachments, historical lookup, branding, or print settings.
- Verify mobile layout and readable font sizes.
- Run the repository CI workflow and record exact results.

## 9. Delivery and handoff rules

- Work on `integration/unified-test-2026-11-19` (or a clearly named feature branch based on it); do not push unreviewed work to `main`.
- Create/retain a backup reference before major changes.
- Update this document with implementation status, changed files, commits, tests, known limitations, and the exact live preview URL.
- Do not ask the owner to repeat any decision recorded here. Ask only if a genuinely new product decision is required.
- Owner's final acceptance happens through live preview. After acceptance, only live-preview observations/bug fixes should remain; do not reopen settled design decisions.

## 10. Current baseline inspected

At the time this handoff was written:
- `app/results-workbench.html` contains login/workspace shell, tenant/branch/staff selectors, one work-list container, historical lookup and pager.
- `assets/css/results-workbench.css` contains a compact single-column work-card/parameter UI and responsive rules.
- `assets/js/results-workbench.js` contains current work-list grouping and result controls, draft saving, completion/approval, PDF upload-based report publishing, historical lookup, attachments, and culture isolate/susceptibility handling. The current print function builds HTML inside JavaScript rather than using a separate report template file.
- The agreed three-column experience, combined individual workspace, separate profile workspaces, report preview builder, configurable three-zone header/footer, watermark settings, and safe hide/archive flow must be implemented and tested rather than assumed to exist.


---

## 11. Implementation status — 2026-11-21

**Working branch:** `feature/results-workbench-final-2026-11-21`  
**Pull request:** [#24 — Results workbench rebuild](https://github.com/teba-labs/teba-saas-demo/pull/24)  
**Current branch head at this update:** `9d855bf824940cb4b13d8eec5559f52e55343b8d`  
**Main remains unchanged:** `db3c1db1acfe0e4605b574bd4e9926b3dc85b55a`  
**PR state:** open, draft, not merged.

### Implemented on the development branch

- Replaced the old single-list results presentation with a three-column visits / individual tests / profiles workspace and a horizontal selected-visit action bar.
- Individual tests remain together in one entry workspace. Profiles open one at a time in separate focused workspaces; their hidden form nodes remain mounted so unsaved entries are not discarded when moving between profiles.
- Added per-column catalog access. Missing tests are added to the selected visit through the atomic RPC, with staff attribution and creation time. Duplicate additions are idempotent.
- Added reception/billing synchronization for a test added from results. The visit gross total is recalculated from active visit-test price snapshots; the generated net total and existing discount remain consistent.
- Added visit-and-parameter-specific reference-range overrides. Catalog values are not edited; the selected visit's result snapshot uses the override. Range changes are audited, old flags are cleared, and the report recalculates flags against the updated visit-specific range.
- Added audited correction of completed results before approval and after publication, including recalculated low/high/normal flags. Previous published report files remain preserved; corrected output requires a new preview and corrected publication.
- Added unsaved-result guards before changing visit, branch, refreshing, adding a test, hiding a case, approving, previewing, or publishing.
- Added hide/restore (logical archive) for visits with an audit event. There is no ordinary hard-delete action for medical records.
- Added WhatsApp action only when a patient phone exists and the report is published. It opens a prefilled WhatsApp message containing the patient-portal lookup link and visit number; it does not attach a PDF directly.
- Added visit-results preview before final print/publication. Incomplete sections are identified; print is disabled until approval; publication requires a fresh preview and an approved/published visit.
- Reworked the report template with English test data and Arabic patient/lab administrative data. Header and footer use right/center/left zones; header identity side is configurable; center logo can be general or branch-specific; footer supports all active branch addresses and phone numbers, WhatsApp, website/support links, optional QR/message center, branch-performed line, and a configurable watermark.
- Print header and footer repeat in printed pages. Individual tests form one combined report flow; each profile begins a separate report page.
- Added the corresponding print-settings controls for logo source, identity side, branch addresses/contacts, website/support URLs, optional footer center, watermark type/opacity/size/position, while retaining paper size/orientation/margins and existing brand/signature settings.
- Updated service-worker shell cache version to v27 and added the new workbench layout module to the application shell.

### Database migrations applied to TEST only

Migrations `056` through `068` are present in the repository and applied to TEST project `hgqwpykeazuzceeiumjg`. They cover safe visit archive/restore, atomic test addition, visit-specific range overrides and history, completed/published result corrections, billing recalculation for added tests, stale-flag handling, and finalized-visit guards.

No production database was modified.

### Verification completed

- Static contract tests: **235/235 passed** on run [44833208993](https://github.com/teba-labs/teba-saas-demo/actions/runs/44833208993).
- JavaScript syntax/module checks passed.
- Browser-only deployment build passed.
- Exact source artifact was packaged and uploaded by the successful workflow.
- TEST transaction smoke checks (all rolled back): archive/hide and restore; idempotent add-test behavior; billing gross/net reconciliation after adding a test; visit-only range override and result reference snapshot; completed-result correction with reason and flag.
- Supabase security advisor showed no new findings for the added public RPCs/tables. Performance advisor reports the new audit/range indexes as unused on the currently small TEST dataset; this is expected until those tables have workload.

### Remaining live-review items / limitations

- The Netlify preview deployment cannot currently produce a live URL because this repository environment does not have the required Netlify authentication/site secrets. The existing GitHub Pages site still serves `main`; it was not overwritten to expose an unreviewed development build.
- WhatsApp is a prefilled `wa.me` share flow to the patient portal, not a direct PDF attachment or automated WhatsApp Business API delivery.
- The existing publication workflow remains: preview the report, print/save as PDF from the browser, then upload/publish through the existing report-version flow.
- The TEST dataset has no already-published visit, so the published-range-correction path was reviewed in code and migration checks but could not be exercised against an existing published fixture. The unpublished correction and range-snapshot paths were exercised transactionally.
- The TEST dataset has no active employee membership fixture, so the new staff-identity path was validated from the invoker/RLS function contracts and owner transaction tests, not a full employee login session.
- Final visual acceptance remains the owner's live browser review. Do not merge PR #24 into `main` until that review is completed. Any changes after this point should be driven by concrete live-preview observations, not by reopening the settled product decisions above.

## 12. Handoff instruction

A receiving chat/developer must start from this branch and PR #24, read this document, inspect the current implementation and successful CI run, and continue from the latest commit. Do not ask the owner to repeat the three-column layout, individual/profile grouping, print design, range/history rules, archive behavior, or agreed print-settings options.


---

## 13. Main preview integration — 2026-11-21

- PR #24 (results workbench rebuild) was merged to `main` using a squash merge for the owner's requested preview. Merge commit: `90508602bb1d8eb80815bf39bd5f22526231eca2`.
- PR #26 (owner dashboard 18 screens) was then merged onto that main baseline. Merge commit: `727cd43df1604b56c170e02c9fdc4aaed101d1cc`.
- The original feature branches and recovery branches were retained; no branch was deleted and no tracked file was deleted by these integrations.
- The Service Worker keeps both `results-workbench-layout.js` and `modules/dashboard/live-status.js` in APP_SHELL under cache v27.
- PR #24's migrations 056–068 remain repository source and were applied only to TEST. They were **not** run against production as part of this preview merge. Database-dependent new results-workbench operations must not be considered operational against a database missing those migrations.
- PR #26 CI run 44835297244 passed JavaScript syntax checks, browser-only build, packaging, and **250/250 static/unit tests**.
- The GitHub Pages URL was not independently verified by the assistant after merge. Owner visual review in the live browser remains required; no browser end-to-end acceptance is claimed.
- This main merge is for preview and owner review, not final clinical/production acceptance.


---

## 14. Print settings completion — 2026-11-21

- Reviewed the existing System Settings > Printing tab against the agreed report-print requirements. Existing controls already covered paper size/orientation/margins, report title/footer, lab/branch logo selection, identity-side switching, branch addresses, contact visibility, website/support links, optional footer QR/message, and watermark type/opacity/size/position.
- Completed the previously missing configurable content for the opposite header zone. The multiline text is escaped and moves to the opposite side when the lab identity side is switched.
- Added an independent stamp upload/visibility setting and reviewer/approver name/visibility setting. Both are persisted in the existing print-settings JSON and rendered in the final visit report alongside the existing signature.
- Extended the existing tenant asset upload allow-list to support the `stamp` asset kind under the same tenant system-assets path. No database migration was needed; existing tenant storage and print-settings JSON are reused.
- Added regression coverage for the new settings fields, save/load wiring, stamp asset upload support, settings preview, and final report markup.
- PR #27: https://github.com/teba-labs/teba-saas-demo/pull/27
- Validation on a merge candidate based on the current main: workflow run **44906382244** succeeded; JavaScript checks, browser-only deployment build, and **250/250 static/unit tests passed** (0 failed).
- Browser/device visual inspection of actual printed paper output remains a manual acceptance item; CI validates source contracts and build, not physical printer rendering.
- Recovery branch retained: `backup/pre-print-settings-main-2026-11-21`.
