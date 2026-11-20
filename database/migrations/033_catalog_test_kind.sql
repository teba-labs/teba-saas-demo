-- Catalog usability: distinguish single-result tests from panels while preserving visit snapshots.
alter table public.tests_catalog
  add column if not exists test_kind text not null default 'individual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tests_catalog'::regclass
      and conname='tests_catalog_test_kind_check'
  ) then
    alter table public.tests_catalog
      add constraint tests_catalog_test_kind_check
      check (test_kind in ('individual','panel'));
  end if;
end $$;

create or replace function private.add_catalog_kind_to_visit_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
begin
  if tg_op <> 'INSERT' then return new; end if;

  select tc.test_kind into v_kind
  from public.tests_catalog tc
  where tc.tenant_id = new.tenant_id
    and tc.id = new.test_id
    and tc.is_active;

  if v_kind is null then
    raise exception 'Active catalog test is required before creating a visit test';
  end if;

  new.technical_snapshot := jsonb_set(
    coalesce(new.technical_snapshot, '{}'::jsonb),
    '{test_kind}',
    to_jsonb(v_kind),
    true
  );
  return new;
end;
$$;

revoke all on function private.add_catalog_kind_to_visit_snapshot() from public, anon, authenticated;

drop trigger if exists zzz_catalog_kind_snapshot on public.visit_tests;
create trigger zzz_catalog_kind_snapshot
before insert on public.visit_tests
for each row execute function private.add_catalog_kind_to_visit_snapshot();

comment on column public.tests_catalog.test_kind is
  'individual = one primary result parameter; panel = a group of technical parameters';
