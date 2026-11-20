# Reception workflow completion handoff — 2026-11-20

## Scope
This branch completes the reception page as a small-lab operational workspace, rather than a visual-only mockup.

## Patient and visit intake
- Patient name is required; phone is optional; address field is intentionally omitted.
- Age is entered as a numeric value with days, months, or years (years default). The entered value and unit are stored; age_years remains a normalized compatibility value for result reference-range logic.
- Sex must be selected explicitly (male/female/unspecified).
- Patient file code and visit number are generated automatically; visit date is taken from the active branch workday.
- Referral source and medical/administrative notes are available.

## Tests and billing
- Catalog search and multi-select remain connected to current branch prices and active technical parameters.
- Tests without a current price or technical parameters cannot be selected.
- Gross total, discount, net total, paid amount, and remaining balance update as the selection changes.
- Visit, test snapshots, invoice, and initial payment continue to use the existing atomic idempotent intake RPC.
- Existing follow-up debt collection and receipt printing are retained.

## Post-save workflow
- Online confirmed visits expose a direct action to open the results workbench scoped to the exact visit_id.
- The results workbench's branch query adds a visit_id filter only when the reception handoff parameter exists.
- The other action resets the intake and opens the new-patient form with focus on the name.
- Offline queued visits do not pretend to be server-confirmed and do not offer results navigation until synchronization confirms the visit.

## Keyboard and presentation
- Responsive RTL design uses a compact, ordered vertical workflow.
- Tab/Shift+Tab use native focus order; Enter advances through text/number inputs; arrow keys move among catalog checkboxes and search matches; Space/Enter toggles the focused catalog checkbox; Escape closes the historical panel.
- Mouse actions remain available for every control.

## Data and safety
- Migration `055_patient_age_units.sql` adds `age_value` and `age_unit` and expands `age_years` precision to four decimals.
- Offline patient replay now verifies age value and unit as part of the idempotent identity snapshot.
- Branch scoping and RLS continue to be enforced by the existing repositories and database RPCs.
- Supabase TEST project `teba-lis-demo` has applied migration `patient_age_units` (recorded after migration 054); `main` has not been changed or merged.
- Backup branch: `backup/pre-reception-complete-2026-11-20`.
- Working branch: `feature/reception-complete-workflow-2026-11-20`.
- Draft PR: https://github.com/teba-labs/teba-saas-demo/pull/22

## Validation status
- Static module syntax checks passed.
- Static contract suite passed: 75 tests, 0 failures (run 44817141628).
- Database migration was applied successfully to the TEST project and the three age columns were verified.
- A real browser workflow with an authenticated employee/owner, live catalog prices, payment, printing, and direct results entry still requires live preview and user acceptance testing.
