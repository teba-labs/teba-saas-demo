-- Patient portal brute-force protection without per-visit lockout.
-- Six failed attempts in five minutes block only the source IP for this tenant for one hour.
-- A caller cannot lock a patient's visit by targeting its visit number or name.

create table if not exists public.portal_ip_rate_limits (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, ip_hash)
);

alter table public.portal_ip_rate_limits enable row level security;
alter table public.portal_ip_rate_limits force row level security;
revoke all on table public.portal_ip_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_ip_rate_limits to service_role;

create index if not exists idx_portal_attempts_tenant_ip_failed_time
  on public.portal_access_attempts(tenant_id, ip_hash, attempted_at desc)
  where ip_hash is not null and succeeded = false;

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
  v_failures integer;
  v_blocked_until timestamptz;
  v_attempt_id uuid;
  v_retry integer;
begin
  if p_tenant_id is null
     or p_lookup_hash is null or p_lookup_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid patient portal rate-limit key' using errcode='22023';
  end if;

  -- Serialize by tenant + source IP only. Never lock by patient name or visit number.
  perform pg_advisory_xact_lock(hashtextextended('portal-ip:' || p_tenant_id::text || ':' || p_ip_hash, 0));

  select blocked_until into v_blocked_until
  from public.portal_ip_rate_limits
  where tenant_id = p_tenant_id and ip_hash = p_ip_hash
  for update;

  if v_blocked_until is not null and v_blocked_until > now() then
    v_retry := greatest(1, ceil(extract(epoch from (v_blocked_until - now())))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry);
  end if;

  select count(*)::integer into v_failures
  from public.portal_access_attempts
  where tenant_id = p_tenant_id
    and ip_hash = p_ip_hash
    and succeeded = false
    and attempted_at >= now() - interval '5 minutes';

  if v_failures >= 6 then
    insert into public.portal_ip_rate_limits(tenant_id, ip_hash, blocked_until, updated_at)
    values(p_tenant_id, p_ip_hash, now() + interval '1 hour', now())
    on conflict (tenant_id, ip_hash) do update
      set blocked_until = excluded.blocked_until, updated_at = excluded.updated_at;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 3600);
  end if;

  insert into public.portal_access_attempts(tenant_id, lookup_hash, ip_hash, succeeded)
  values(p_tenant_id, p_lookup_hash, p_ip_hash, false)
  returning id into v_attempt_id;

  return jsonb_build_object('allowed', true, 'attempt_id', v_attempt_id, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.consume_patient_portal_attempt(uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_patient_portal_attempt(uuid,text,text) to service_role;
