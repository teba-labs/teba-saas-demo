# Batch 29 — Offline safety and attachment foundation

Date: 2026-11-18

## Offline safety changes
- Synchronization now refuses to run unless both tenant and branch are explicitly supplied.
- Candidate operations and expired lease recovery are filtered to that exact tenant/branch.
- Queue summaries, conflict lists, and failed-operation retry require the same explicit scope.
- This prevents one laboratory's sync-center action from mutating another laboratory's queued work in the same browser database.

## Local backup restore corrections
- Cross-device restore no longer copies Dexie auto-increment `local_id` values for outbox/conflict rows.
- Stable `operation_id` and `conflict_id` values remain the portable identities.
- Existing outbox/conflict identities are checked for matching scope and payload; mismatches abort the transaction.
- Existing local business records are preserved instead of overwritten by an older backup.
- `sync_meta` uses its actual primary key (`key`) and is merged without replacing existing acknowledgements/context.
- Restore remains a local cache + pending-operation merge only. It is not a complete tenant backup.

## Attachment foundation
- Added a JWT-verified `upload-attachment` Edge Function source for TEST deployment.
- Allows PDF, JPEG and PNG only, validates file signatures, limits uploads to 10 MiB, and uses an exact origin allowlist.
- Uploads through the authenticated user's Supabase client so Storage and `file_metadata` RLS remain the authorization boundary.
- If metadata insertion fails after object upload, the Edge Function attempts server-side orphan cleanup with the service key.
- Added a browser repository to list visit attachments and create short-lived signed download URLs only after an RLS-scoped metadata lookup.
- The new function requires `ATTACHMENT_ALLOWED_ORIGINS` and is not yet deployed to TEST. No secrets were changed.

## TEST project inspection
- `tenant-attachments` is private, limited to 10 MiB, and already allows PDF/JPEG/PNG/WebP. This implementation intentionally narrows accepted uploads to PDF/JPEG/PNG.
- Existing Storage policy requires authenticated branch access for attachment upload/read; owner-only delete remains unchanged.
- `file_metadata` currently has only owner/branch-scoped SELECT and INSERT policies. No browser UPDATE/DELETE capability was added.
- `file_metadata` and `backup_runs` currently contain zero rows.
- Four Storage buckets exist; `tenant-backups` is private and owner-only for browser read/upload/delete.

## Verification status
- Added static regression tests for scoped sync, safe cross-device restore, and attachment security contracts.
- Added GitHub Actions static test workflow with manual dispatch. The workflow is present, but no run result has been reported yet.
- The attachment Edge Function has not been deployed; no live upload/download test was performed.
- No database migration or TEST data mutation was performed in this batch.

## Remaining work
1. Wire the attachment repository into the appropriate UI and test staff/owner access.
2. Deploy `upload-attachment` to TEST after `ATTACHMENT_ALLOWED_ORIGINS` is configured.
3. Run upload, metadata failure cleanup, branch denial, cross-tenant denial, and signed download tests.
4. Design and implement a separate complete cloud backup/restore workflow, including tenant table coverage, Storage objects, integrity manifests, version retention, restore authorization, and a real restore drill. Do not call local cache export a cloud backup.
5. Run the full Node static suite and browser-based offline replay after the test environment is configured.

## Safety
- Changes are confined to `teba-saas-demo` development branch `cloud-hardening-2026-11-18`.
- The legacy `teba-lab` project and SaaS `main` branch were not modified.
- No production deployment or migration was performed.
