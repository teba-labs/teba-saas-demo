-- Patient portal hardening. Run only on the TEST project after migration 001.
begin;

-- Attempts are written only by the server-side Edge Function using service role.
alter table public.portal_access_attempts enable row level security;
alter table public.portal_access_attempts force row level security;
revoke all on public.portal_access_attempts from anon, authenticated;

create index if not exists idx_portal_attempts_ip_time
  on public.portal_access_attempts(tenant_id, ip_hash, attempted_at desc);

create index if not exists idx_portal_attempts_lookup_time
  on public.portal_access_attempts(tenant_id, lookup_hash, attempted_at desc);

commit;
