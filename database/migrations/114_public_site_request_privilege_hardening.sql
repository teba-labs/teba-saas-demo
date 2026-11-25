-- 114: Remove inherited table privileges from authenticated users for public site requests.
-- Only the tenant owner may read or update requests through RLS; inserts stay server-only.
begin;
revoke all on table public.site_booking_requests from public, anon, authenticated;
grant select, update on table public.site_booking_requests to authenticated;
revoke all on table public.site_request_ip_limits from public, anon, authenticated;
grant all on table public.site_request_ip_limits to service_role;
revoke all on function public.consume_site_request_attempt(uuid,text) from public, anon, authenticated;
grant execute on function public.consume_site_request_attempt(uuid,text) to service_role;
commit;
