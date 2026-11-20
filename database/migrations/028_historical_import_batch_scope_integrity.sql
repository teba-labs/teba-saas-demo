alter table public.historical_import_batches
  add constraint historical_import_batches_tenant_branch_id_unique unique (tenant_id, branch_id, id);
alter table public.historical_results
  drop constraint if exists historical_results_import_batch_fk;
alter table public.historical_results
  add constraint historical_results_import_batch_scope_fk
  foreign key (tenant_id, branch_id, import_batch_id)
  references public.historical_import_batches(tenant_id, branch_id, id)
  on delete restrict;
