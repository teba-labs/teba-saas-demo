-- Batch 28: make public patient-portal rate limiting atomic and tenant-aware.
create index if not exists idx_portal_attempts_global_ip_time
  on public.portal_access_attempts(ip_hash, attempted_at desc)
  where ip_hash is not null;

create or replace function public.consume_patient_portal_attempt(
  p_tenant_id uuid,
  p_lookup_hash text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lookup_count integer;
  v_ip_count integer;
  v_attempt_id uuid;
begin
  if p_tenant_id is null
     or p_lookup_hash is null or p_lookup_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid patient portal rate-limit key' using errcode='22023';
  end if;

  -- All callers acquire locks in the same order to avoid races and deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('portal-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('portal-lookup:' || p_tenant_id::text || ':' || p_lookup_hash, 0));

  select count(*)::integer into v_lookup_count
  from public.portal_access_attempts
  where tenant_id=p_tenant_id and lookup_hash=p_lookup_hash
    and attempted_at >= now() - interval '15 minutes';

  select count(*)::integer into v_ip_count
  from public.portal_access_attempts
  where ip_hash=p_ip_hash
    and attempted_at >= now() - interval '15 minutes';

  if v_lookup_count >= 5 or v_ip_count >= 20 then
    return jsonb_build_object('allowed',false,'retry_after_seconds',900);
  end if;

  insert into public.portal_access_attempts(tenant_id,lookup_hash,ip_hash,succeeded)
  values(p_tenant_id,p_lookup_hash,p_ip_hash,false)
  returning id into v_attempt_id;

  return jsonb_build_object('allowed',true,'attempt_id',v_attempt_id,'retry_after_seconds',0);
end;
$$;

revoke all on function public.consume_patient_portal_attempt(uuid,text,text) from public,anon,authenticated;
grant execute on function public.consume_patient_portal_attempt(uuid,text,text) to service_role;
