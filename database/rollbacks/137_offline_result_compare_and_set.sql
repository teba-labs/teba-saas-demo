-- Rollback additive stage only: remove the new RPC, leave legacy behavior untouched.
begin;
drop function if exists public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb);
notify pgrst, 'reload schema';
commit;
