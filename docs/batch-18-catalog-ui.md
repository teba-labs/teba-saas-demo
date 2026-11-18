# Batch 18 — Catalog management screen

Date: 18 November 2026

## Implemented
- Added an Arabic RTL catalog management screen at `app/catalog.html`, with responsive styling and authenticated tenant selection.
- Added catalog entry to the unified launcher for both owner and staff roles.
- Added test create/edit, active/inactive state, search, and optional inactive listing.
- Added parameter create/edit, unit, value type, decimal precision, display order, required/active flags, reference range JSON, and choice JSON. Reference ranges accept either an object (including the existing results UI's `{text: ...}` shape) or an array; choices remain an array.
- Added current-price display and owner-only price editor. UI checks the tenant membership role; database RLS remains the enforcement boundary. Employees do not receive a price editor.
- Added offline-shell pre-cache entries and bumped service-worker cache to v3. Catalog viewing can use cached rows; catalog writes are explicitly online-only.
- Fixed a cache correctness issue: online catalog/parameter reads now cache both active and inactive rows before filtering what the caller sees. This prevents a routine active-only reception read from erasing inactive rows needed by catalog management.

## Validation
- `node --test tests/static/*.test.mjs`: 78/78 passed.
- JavaScript syntax: 34/34 files passed `node --check` (excluding `source_original/`).
- Original-source manifest: 31/31 hashes match.
- No SQL was run, no migration was added or applied, no Supabase project was contacted, and no deployment occurred.
- Browser runtime verification was not completed in this environment; tests are static contracts and syntax checks, not proof of live browser/database behavior.

## Known limitations / next work
- Price history update is still two separate client requests (close old current row, then insert new row). An atomic RPC/migration is recommended before production, but must be reviewed and explicitly approved before any execution.
- Catalog management writes require internet; offline editing/queueing is not implemented.
- Reference ranges and choice sets are edited as JSON for now; a friendlier clinical range builder can follow after agreeing the exact data shape and age/sex-specific range requirements.
- Next: test the page in a real browser against TEST with owner and employee accounts, verify RLS outcomes, then review atomic price update design. Do not ask the user to repeat previously completed tenant-isolation tests unless a new finding requires it.
