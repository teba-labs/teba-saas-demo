-- Migration 076: branch-scoped, concurrency-safe human-readable visit numbers.
-- Apply only after review on the intended SaaS primary database.
begin;

create table if not exists private.branch_visit_sequences (
  tenant_id uuid not null,
  branch_id uuid not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict
);

alter table private.branch_visit_sequences enable row level security;
revoke all on table private.branch_visit_sequences from public, anon, authenticated;

create or replace function public.reserve_branch_visit_number(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_tenant_code text,
  p_branch_code text
) returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_next bigint;
  v_tenant_code text := upper(regexp_replace(coalesce(p_tenant_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_branch_code text := upper(regexp_replace(coalesce(p_branch_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then raise exception 'Branch not accessible'; end if;
  if length(v_tenant_code) not between 2 and 4 or length(v_branch_code) not between 2 and 4 then
    raise exception 'Valid laboratory and branch codes are required';
  end if;

  insert into private.branch_visit_sequences(tenant_id, branch_id, last_value)
  values (p_tenant_id, p_branch_id, 1)
  on conflict (tenant_id, branch_id)
  do update set last_value = private.branch_visit_sequences.last_value + 1,
                updated_at = now()
  returning last_value into v_next;

  return v_tenant_code || '-' || v_branch_code || '-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.reserve_branch_visit_number(uuid, uuid, text, text) from public, anon;
grant execute on function public.reserve_branch_visit_number(uuid, uuid, text, text) to authenticated;

commit;
