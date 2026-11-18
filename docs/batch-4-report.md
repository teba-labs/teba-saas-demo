# Batch 4 — Laboratory and Results repositories

Implemented as service/repository foundations; not yet wired into HTML screens.

- Branch-scoped laboratory work queue with visit and patient display fields.
- Visit-test status changes are restricted to known states.
- Draft result entry validates numeric/text values and records staff attribution.
- Result entry refuses normal edits after publication; no silent published-result correction path is exposed.
- Test completion checks all required parameter codes in the technical snapshot before setting `completed`.
- Visit approval checks all non-cancelled tests are completed and records staff ID and timestamp.

Important limitation: publication and correction are not implemented here. The schema has report-version guards, but a complete PDF storage + publication + immutable correction workflow must be built and tested as one operation before the patient portal is enabled.
