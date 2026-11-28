-- Restrict the additive compare-and-set SECURITY DEFINER RPC to signed-in clients.
revoke all on function public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_draft_results_idempotent_v2(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
