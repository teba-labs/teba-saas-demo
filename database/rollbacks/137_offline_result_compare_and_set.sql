-- Safe rollback for migration 137.
-- This removes only the new compare-and-set RPC. It deliberately keeps the legacy
-- draft-result RPC in insert-only mode, keeps direct UPDATE/DELETE guards active, and
-- keeps direct execution of the unsafe atomic upsert RPC revoked. Existing result rows
-- are never modified or deleted. The previous client can still insert new values; updates
-- to existing results fail closed until a compatible compare-and-set client is restored.
-- Roll back the application code to a compatible client before executing this file.

begin;
drop function if exists public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb);
revoke all on function public.save_draft_results_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
commit;
