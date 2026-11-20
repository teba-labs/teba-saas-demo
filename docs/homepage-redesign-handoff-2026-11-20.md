# Homepage redesign — development handoff
Date: 2026-11-20
Repository: teba-labs/teba-saas-demo
Base: main at 1092d53953182a60ffd0336412edc8ac4ea5250b
Backup: backup/pre-homepage-redesign-2026-11-20
Working branch: feature/homepage-premium-workspace-2026-11-20

## Scope
Complete redesign of the authenticated launcher / homepage only. Reception and results pages are intentionally not redesigned in this phase.

## Current implementation
- `app/index.html`: redesigned Arabic RTL login and workspace shell.
- `assets/css/app-home.css`: premium medical visual system, responsive layouts, owner tools panel, workday and sync summaries.
- `assets/js/app-home.js`: keeps Supabase authentication and authoritative tenant context; remembers only validated tenant/branch choices; displays shared operational cards; loads current workday and local outbox summary for the selected branch.
- Staff can access reception, results, catalog, workday and sync center. Owner additionally sees the financial dashboard and owner-only system settings / CMS links.
- Catalog card is shared. Catalog's own page remains responsible for technical staff permissions and owner-only price editing; homepage visibility is not an authorization boundary.
- `service-worker.js`: shell cache advanced to v25; existing app-home CSS/JS and required modules remain precached.
- `tests/static/app-integration.test.mjs`: updated contracts for shared catalog access, owner-only controls, responsive launcher, and live workday/sync status.

## Important boundaries / known limitations
- No new database migration or RLS change was needed for the homepage.
- A dedicated patient-portal settings screen does not exist in the current main tree; do not create a fake shortcut. Existing patient portal is a public-facing route under `portal/index.html`; settings work should be handled when the settings/portal configuration scope is implemented.
- Workday opening/closing stays inside `workday.html`, because it requires employee identity and explicit confirmation; homepage only reports status and links to the operational screen.
- Do not merge to main until the owner reviews the preview and explicitly approves.
- Do not redesign reception or results as part of this homepage branch unless separately authorized.

## Continuation checklist
1. Fetch latest branch head and compare with main; preserve this branch and backup.
2. Run `node --experimental-default-type=module --check assets/js/app-home.js`.
3. Run `node --test tests/static/app-integration.test.mjs tests/static/workspace-selection.test.mjs tests/static/tenant-branding.test.mjs`.
4. Run the repository's full static contract test workflow.
5. Check the GitHub Pages preview at `https://teba-labs.github.io/teba-saas-demo/app/index.html` after confirming Pages publishes this branch; otherwise use a draft PR preview or deploy the branch through the configured preview workflow.
6. Verify owner and employee accounts, multi-tenant/branch selection, workday status, offline fallback, and outbox summary.
7. Report any tests not executable in this environment as unverified; do not claim a live browser test unless actually performed.
8. Wait for owner approval before merging to main.

## Latest known completed commit
`001ae61f1b22304713ed47036d92b4e13a62e009` (service worker cache refresh).