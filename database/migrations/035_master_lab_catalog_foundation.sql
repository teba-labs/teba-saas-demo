-- Master medical catalog foundation. Global definitions are read-only to tenants;
-- each laboratory imports an editable tenant-owned copy.
alter table public.tests_catalog
  add column if not exists short_name text,
  add column if not exists synonyms text[] not null default '{}',
  add column if not exists loinc_code text,
  add column if not exists clinical_category text,
  add column if not exists clinical_purpose text,
  add column if not exists service_type text not null default 'laboratory_test'
    check (service_type in ('laboratory_test','service','procedure','panel')),
  add column if not exists patient_preparation jsonb not null default '{}'::jsonb,
  add column if not exists collection_requirements jsonb not null default '{}'::jsonb,
  add column if not exists specimen_requirements jsonb not null default '{}'::jsonb,
  add column if not exists transport_requirements jsonb not null default '{}'::jsonb,
  add column if not exists stability_requirements jsonb not null default '{}'::jsonb,
  add column if not exists rejection_criteria text[] not null default '{}',
  add column if not exists biosafety_notes text,
  add column if not exists critical_result_policy jsonb not null default '{}'::jsonb,
  add column if not exists reporting_notes text,
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists clinical_review_status text not null default 'needs_review'
    check (clinical_review_status in ('draft','needs_review','verified','deprecated')),
  add column if not exists clinical_reviewed_by uuid,
  add column if not exists clinical_reviewed_at timestamptz,
  add column if not exists catalog_version text;

alter table public.test_parameters
  add column if not exists unit_ucum text,
  add column if not exists alternate_units jsonb not null default '[]'::jsonb,
  add column if not exists critical_ranges jsonb not null default '{}'::jsonb,
  add column if not exists interpretation_rules jsonb not null default '[]'::jsonb,
  add column if not exists applicability jsonb not null default '{}'::jsonb,
  add column if not exists method_notes text,
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists clinical_review_status text not null default 'needs_review'
    check (clinical_review_status in ('draft','needs_review','verified','deprecated')),
  add column if not exists clinical_reviewed_by uuid,
  add column if not exists clinical_reviewed_at timestamptz;

create table if not exists public.master_catalog_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.master_catalog_tests (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.master_catalog_releases(id) on delete restrict,
  master_code text not null,
  canonical_name text not null,
  alternate_names text[] not null default '{}',
  test_kind text not null check (test_kind in ('individual','panel')),
  category text,
  service_type text not null default 'laboratory_test'
    check (service_type in ('laboratory_test','service','procedure','panel')),
  definition jsonb not null default '{}'::jsonb,
  clinical_review_status text not null default 'needs_review'
    check (clinical_review_status in ('draft','needs_review','verified','deprecated')),
  source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id, master_code)
);

create table if not exists public.master_catalog_parameters (
  id uuid primary key default gen_random_uuid(),
  master_test_id uuid not null references public.master_catalog_tests(id) on delete restrict,
  parameter_code text not null,
  parameter_name text not null,
  unit text,
  unit_ucum text,
  value_type text not null default 'numeric'
    check (value_type in ('numeric','text','boolean','choice')),
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  reference_ranges jsonb not null default '[]'::jsonb,
  critical_ranges jsonb not null default '{}'::jsonb,
  choices jsonb not null default '[]'::jsonb,
  applicability jsonb not null default '{}'::jsonb,
  interpretation_rules jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  is_required boolean not null default true,
  result_source text not null default 'manual' check (result_source in ('manual','calculated')),
  formula jsonb,
  clinical_metadata jsonb not null default '{}'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  clinical_review_status text not null default 'needs_review'
    check (clinical_review_status in ('draft','needs_review','verified','deprecated')),
  unique (master_test_id, parameter_code),
  check ((result_source='manual' and formula is null) or (result_source='calculated' and value_type='numeric' and formula is not null))
);

create table if not exists public.tenant_catalog_master_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  test_id uuid not null,
  master_test_id uuid not null references public.master_catalog_tests(id) on delete restrict,
  imported_release_id uuid not null references public.master_catalog_releases(id) on delete restrict,
  imported_at timestamptz not null default now(),
  last_applied_version text not null,
  baseline_snapshot jsonb not null default '{}'::jsonb,
  customization_fields text[] not null default '{}',
  sync_status text not null default 'current'
    check (sync_status in ('current','update_available','customized','review_required')),
  unique (tenant_id, master_test_id),
  unique (tenant_id, test_id),
  foreign key (tenant_id, test_id) references public.tests_catalog(tenant_id,id) on delete cascade
);

create index if not exists idx_master_catalog_tests_release on public.master_catalog_tests(release_id, category, canonical_name);
create index if not exists idx_master_catalog_parameters_test on public.master_catalog_parameters(master_test_id, display_order);
create index if not exists idx_tenant_catalog_master_links_tenant on public.tenant_catalog_master_links(tenant_id, sync_status);

alter table public.master_catalog_releases enable row level security;
alter table public.master_catalog_tests enable row level security;
alter table public.master_catalog_parameters enable row level security;
alter table public.tenant_catalog_master_links enable row level security;

drop policy if exists master_catalog_releases_authenticated_read on public.master_catalog_releases;
create policy master_catalog_releases_authenticated_read on public.master_catalog_releases
  for select to authenticated using (status='published');

drop policy if exists master_catalog_tests_authenticated_read on public.master_catalog_tests;
create policy master_catalog_tests_authenticated_read on public.master_catalog_tests
  for select to authenticated using (
    exists(select 1 from public.master_catalog_releases r where r.id=release_id and r.status='published')
  );

drop policy if exists master_catalog_parameters_authenticated_read on public.master_catalog_parameters;
create policy master_catalog_parameters_authenticated_read on public.master_catalog_parameters
  for select to authenticated using (
    exists(
      select 1 from public.master_catalog_tests t
      join public.master_catalog_releases r on r.id=t.release_id
      where t.id=master_test_id and r.status='published'
    )
  );

drop policy if exists tenant_catalog_master_links_member_read on public.tenant_catalog_master_links;
create policy tenant_catalog_master_links_member_read on public.tenant_catalog_master_links
  for select to authenticated using (private.is_tenant_member(tenant_id));

drop policy if exists tenant_catalog_master_links_owner_insert on public.tenant_catalog_master_links;
create policy tenant_catalog_master_links_owner_insert on public.tenant_catalog_master_links
  for insert to authenticated with check (private.is_tenant_owner(tenant_id));

drop policy if exists tenant_catalog_master_links_owner_update on public.tenant_catalog_master_links;
create policy tenant_catalog_master_links_owner_update on public.tenant_catalog_master_links
  for update to authenticated using (private.is_tenant_owner(tenant_id))
  with check (private.is_tenant_owner(tenant_id));

revoke all on public.master_catalog_releases, public.master_catalog_tests, public.master_catalog_parameters from anon, authenticated;
grant select on public.master_catalog_releases, public.master_catalog_tests, public.master_catalog_parameters to authenticated;
revoke all on public.tenant_catalog_master_links from anon, authenticated;
grant select, insert, update on public.tenant_catalog_master_links to authenticated;

create or replace function public.import_master_catalog_test(
  p_tenant_id uuid,
  p_master_test_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_master public.master_catalog_tests%rowtype;
  v_release public.master_catalog_releases%rowtype;
  v_test_id uuid;
  v_existing uuid;
  v_definition jsonb;
  v_parameters jsonb;
  v_param jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the tenant owner may import master catalog tests'; end if;

  select * into v_master from public.master_catalog_tests
   where id=p_master_test_id;
  if not found then raise exception 'Master catalog test was not found'; end if;
  select * into v_release from public.master_catalog_releases
   where id=v_master.release_id and status='published';
  if not found then raise exception 'Only tests in a published master release can be imported'; end if;

  select test_id into v_existing from public.tenant_catalog_master_links
   where tenant_id=p_tenant_id and master_test_id=p_master_test_id;
  if v_existing is not null then return v_existing; end if;

  if exists(select 1 from public.tests_catalog where tenant_id=p_tenant_id and code=v_master.master_code) then
    raise exception 'A tenant test already uses master code %. Rename the existing test before importing.',v_master.master_code;
  end if;

  v_definition:=coalesce(v_master.definition,'{}'::jsonb);
  insert into public.tests_catalog(
    tenant_id,code,name,test_kind,category,specimen,method,turnaround_minutes,instructions,is_active,
    short_name,synonyms,loinc_code,clinical_category,clinical_purpose,service_type,
    patient_preparation,collection_requirements,specimen_requirements,transport_requirements,
    stability_requirements,rejection_criteria,biosafety_notes,critical_result_policy,
    reporting_notes,source_references,clinical_review_status,catalog_version
  ) values (
    p_tenant_id,v_master.master_code,v_master.canonical_name,v_master.test_kind,
    coalesce(v_master.category,v_definition->>'category'),
    v_definition->>'specimen',v_definition->>'method',
    nullif(v_definition->>'turnaround_minutes','')::integer,v_definition->>'instructions',true,
    v_definition->>'short_name',coalesce(v_master.alternate_names,'{}'),
    v_definition->>'loinc_code',v_definition->>'clinical_category',v_definition->>'clinical_purpose',
    coalesce(v_master.service_type,'laboratory_test'),
    coalesce(v_definition->'patient_preparation','{}'::jsonb),
    coalesce(v_definition->'collection_requirements','{}'::jsonb),
    coalesce(v_definition->'specimen_requirements','{}'::jsonb),
    coalesce(v_definition->'transport_requirements','{}'::jsonb),
    coalesce(v_definition->'stability_requirements','{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(v_definition->'rejection_criteria','[]'::jsonb))),'{}'),
    v_definition->>'biosafety_notes',
    coalesce(v_definition->'critical_result_policy','{}'::jsonb),
    v_definition->>'reporting_notes',
    coalesce(v_definition->'source_references','[]'::jsonb),
    v_master.clinical_review_status,v_release.version
  ) returning id into v_test_id;

  for v_param in
    select to_jsonb(p) from public.master_catalog_parameters p
     where p.master_test_id=p_master_test_id order by p.display_order,p.parameter_code
  loop
    insert into public.test_parameters(
      tenant_id,test_id,parameter_code,parameter_name,unit,value_type,decimal_places,
      reference_ranges,choices,display_order,is_required,is_active,result_source,formula,
      unit_ucum,critical_ranges,interpretation_rules,applicability,source_references,clinical_review_status
    ) values (
      p_tenant_id,v_test_id,v_param->>'parameter_code',v_param->>'parameter_name',v_param->>'unit',
      coalesce(v_param->>'value_type','numeric'),coalesce((v_param->>'decimal_places')::smallint,2),
      coalesce(v_param->'reference_ranges','[]'::jsonb),coalesce(v_param->'choices','[]'::jsonb),
      coalesce((v_param->>'display_order')::integer,0),coalesce((v_param->>'is_required')::boolean,true),true,
      coalesce(v_param->>'result_source','manual'),v_param->'formula',v_param->>'unit_ucum',
      coalesce(v_param->'critical_ranges','{}'::jsonb),coalesce(v_param->'interpretation_rules','[]'::jsonb),
      coalesce(v_param->'applicability','{}'::jsonb),coalesce(v_param->'source_references','[]'::jsonb),
      coalesce(v_param->>'clinical_review_status','needs_review')
    );
  end loop;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order,p.parameter_code),'[]'::jsonb)
    into v_parameters from public.test_parameters p
   where p.tenant_id=p_tenant_id and p.test_id=v_test_id;

  insert into public.tenant_catalog_master_links(
    tenant_id,test_id,master_test_id,imported_release_id,last_applied_version,
    baseline_snapshot,customization_fields,sync_status
  ) values (
    p_tenant_id,v_test_id,p_master_test_id,v_release.id,v_release.version,
    jsonb_build_object('test', (select to_jsonb(t) from public.tests_catalog t where t.id=v_test_id),
                       'parameters',v_parameters),
    '{}','current'
  );
  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid,uuid) from public,anon;
grant execute on function public.import_master_catalog_test(uuid,uuid) to authenticated;

comment on table public.master_catalog_tests is 'Curated global medical catalog. Read-only to tenant accounts; imported into tenant-owned editable copies.';
comment on table public.tenant_catalog_master_links is 'Tracks opt-in imports and baseline snapshots so later master updates can preserve tenant customizations.';
comment on column public.tests_catalog.clinical_review_status is 'Medical governance state; only verified definitions should be used as approved clinical defaults.';
comment on column public.test_parameters.reference_ranges is 'Structured age/sex/pregnancy/population-specific intervals with units, boundaries, and source metadata.';
comment on column public.test_parameters.critical_ranges is 'Structured critical thresholds, distinct from reference intervals.';
