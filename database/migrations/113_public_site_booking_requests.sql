-- 113: Public-site home-sampling and package inquiry requests.
-- Public visitors submit through the submit-site-request Edge Function only.
-- Tenant owners can review and update status; public roles cannot read request data.
begin;

create table if not exists public.site_booking_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_type text not null check (request_type in ('home_sampling','package_inquiry')),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone text not null check (phone ~ '^\\+?[0-9]{7,20}$'),
  branch_id uuid references public.branches(id) on delete set null,
  package_id uuid references public.site_packages(id) on delete set null,
  package_title_snapshot text,
  preferred_date date,
  preferred_period text check (preferred_period is null or preferred_period in ('morning','afternoon','evening')),
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new','contacted','scheduled','closed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_booking_package_request_consistency check (
    (request_type = 'package_inquiry' and package_id is not null)
    or (request_type = 'home_sampling' and package_id is null)
  )
);

create index if not exists idx_site_booking_requests_tenant_created
  on public.site_booking_requests (tenant_id, created_at desc);
create index if not exists idx_site_booking_requests_tenant_status
  on public.site_booking_requests (tenant_id, status, created_at desc);

alter table public.site_booking_requests enable row level security;
alter table public.site_booking_requests force row level security;
revoke all on table public.site_booking_requests from public, anon;
grant select, update on table public.site_booking_requests to authenticated;
grant all on table public.site_booking_requests to service_role;

drop policy if exists site_booking_requests_owner_read on public.site_booking_requests;
create policy site_booking_requests_owner_read
  on public.site_booking_requests for select to authenticated
  using (private.is_tenant_owner(tenant_id));

drop policy if exists site_booking_requests_owner_update on public.site_booking_requests;
create policy site_booking_requests_owner_update
  on public.site_booking_requests for update to authenticated
  using (private.is_tenant_owner(tenant_id))
  with check (private.is_tenant_owner(tenant_id));

create table if not exists public.site_request_ip_limits (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, ip_hash)
);

alter table public.site_request_ip_limits enable row level security;
alter table public.site_request_ip_limits force row level security;
revoke all on table public.site_request_ip_limits from public, anon, authenticated;
grant all on table public.site_request_ip_limits to service_role;

create or replace function public.consume_site_request_attempt(
  p_tenant_id uuid,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_row public.site_request_ip_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_tenant_id is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid public-site rate-limit key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('site-request:' || p_tenant_id::text || ':' || p_ip_hash, 0));

  select * into v_row
  from public.site_request_ip_limits
  where tenant_id = p_tenant_id and ip_hash = p_ip_hash
  for update;

  if not found then
    insert into public.site_request_ip_limits(tenant_id, ip_hash, window_started_at, request_count, updated_at)
    values (p_tenant_id, p_ip_hash, v_now, 1, v_now);
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer)
    );
  end if;

  if v_row.window_started_at <= v_now - interval '15 minutes' then
    update public.site_request_ip_limits
       set window_started_at = v_now, request_count = 1, blocked_until = null, updated_at = v_now
     where tenant_id = p_tenant_id and ip_hash = p_ip_hash;
  elsif v_row.request_count >= 5 then
    update public.site_request_ip_limits
       set blocked_until = v_now + interval '1 hour', updated_at = v_now
     where tenant_id = p_tenant_id and ip_hash = p_ip_hash;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 3600);
  else
    update public.site_request_ip_limits
       set request_count = request_count + 1, updated_at = v_now
     where tenant_id = p_tenant_id and ip_hash = p_ip_hash;
  end if;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$function$;

revoke all on function public.consume_site_request_attempt(uuid,text) from public, anon, authenticated;
grant execute on function public.consume_site_request_attempt(uuid,text) to service_role;

comment on table public.site_booking_requests is
  'Public website home-sampling and package inquiry requests. Visible only to the owning tenant.';
comment on table public.site_request_ip_limits is
  'Hashed source-IP rate limits for public website requests; no raw IP addresses are stored.';
comment on function public.consume_site_request_attempt(uuid,text) is
  'Atomic tenant-scoped rate limit for public website request submissions.';

commit;
