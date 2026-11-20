alter table public.master_catalog_parameters add column if not exists alternate_units jsonb not null default '[]'::jsonb;
