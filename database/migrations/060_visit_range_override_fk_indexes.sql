-- Cover all new foreign keys on the visit-specific reference interval audit tables.
create index if not exists idx_visit_range_overrides_updated_by
  on public.visit_test_parameter_range_overrides(updated_by)
  where updated_by is not null;
create index if not exists idx_visit_range_overrides_staff
  on public.visit_test_parameter_range_overrides(tenant_id,branch_id,updated_by_staff_id);
create index if not exists idx_visit_range_events_visit
  on public.visit_test_parameter_range_events(tenant_id,visit_test_id);
