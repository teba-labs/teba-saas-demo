# Batch 32 — Non-destructive legacy data review

Date: 2026-11-18
Branch: `cloud-hardening-2026-11-18`

## Implemented

- Added strict date review: ISO `YYYY-MM-DD` can be validated; day/month strings where both components are <= 12 are marked ambiguous; unsupported textual formats are marked for review. No locale guessing or automatic date rewrite.
- Added age review that preserves the original age and original unit, parses a numeric candidate only for inspection, and deliberately leaves `ageYears` null. Known units do not authorize a lossy conversion.
- Added finance review for legacy cumulative `paid_amount` versus visit-linked ledger entries. It flags a possible duplicate representation or manual reconciliation; it never creates a payment or sums balances into a new transaction.
- Kept original `results_data` payload in the review object and enumerates parameter paths/types with depth/count limits. Invalid JSON is flagged, not repaired.
- Extended per-sheet analysis with age/date/result review counters and exposed the counters in the local archive inspection UI.
- Added synthetic tests for ages in years/months/days, ambiguous and invalid dates, duplicate finance representation, and nested result payloads.

## Safety boundaries

- No real patient rows, result values, financial rows, or workbook contents were queried or uploaded.
- No import, data persistence, database writes, schema changes, Storage changes, or deployment.
- No branch IDs or visit IDs are converted to UUIDs. Source IDs remain source identifiers.
- This is a preflight review, not a production importer. Branch UUID matching, catalog reconciliation, result-parameter mapping, attachment inventory, and full finance semantics still require explicit mappings and review before a real import.
- The UI remains browser-local and temporary. Raw workbook rows are held in page memory only until the tab is closed.

## Verification status

- Synthetic unit tests were added; GitHub Actions result is pending until the latest commit workflow completes.
- No live browser test has been performed because no preview deployment is available.
- No claim is made that the complete Taiba archive has been located; legacy cloud row counts do not include offline IndexedDB or separate Excel backups.
