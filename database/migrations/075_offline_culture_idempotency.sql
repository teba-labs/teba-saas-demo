-- 075: Idempotent offline culture isolate and AST synchronization.
begin;

create or replace function public.save_culture_isolate_idempotent(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_receipt private.offline_operation_receipts%rowtype;
  v_payload jsonb;
  v_result_id uuid;
  v_visit_status text;
  v_published boolean;
  v_test_status text;
  v_number smallint;
  v_count numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied' using errcode='42501'; end if;
  if p_staff_id is null or not exists(
    select 1 from public.staff_directory sd where sd.id=p_staff_id
      and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required' using errcode='42501'; end if;

  select vt.status,v.status,v.is_published into v_test_status,v_visit_status,v_published
    from public.visit_tests vt join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id
   where vt.id=p_visit_test_id and vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and v.branch_id=p_branch_id
   for update of v,vt;
  if not found then raise exception 'Visit test was not found for this tenant and branch'; end if;
  if v_test_status in ('completed','cancelled') or v_visit_status in ('approved','published','cancelled') or coalesce(v_published,false) then
    raise exception 'Completed or approved culture results are locked';
  end if;

  v_number := nullif(p_payload->>'isolate_number','')::smallint;
  v_count := nullif(p_payload->>'colony_count','')::numeric;
  if v_number is null or v_number<1 or v_number>20 then raise exception 'Invalid isolate number'; end if;
  if nullif(btrim(coalesce(p_payload->>'organism_name','')),'') is null then raise exception 'Organism name is required'; end if;
  if v_count is not null and v_count<0 then raise exception 'Invalid colony count'; end if;

  v_payload:=jsonb_build_object('kind','culture_isolate','visit_test_id',p_visit_test_id,'staff_id',p_staff_id,'payload',p_payload);
  insert into private.offline_operation_receipts(tenant_id,branch_id,operation_id,created_by,payload)
  values(p_tenant_id,p_branch_id,p_operation_id,auth.uid(),v_payload)
  on conflict(tenant_id,branch_id,operation_id) do nothing;
  select * into v_receipt from private.offline_operation_receipts
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id for update;
  if not found then raise exception 'Offline operation receipt could not be locked'; end if;
  if v_receipt.created_by is distinct from auth.uid() then raise exception 'Offline operation belongs to another user' using errcode='42501'; end if;
  if v_receipt.payload is distinct from v_payload then raise exception 'Idempotency key reused with different payload'; end if;
  if cardinality(v_receipt.result_ids)>0 then return v_receipt.result_ids[1]; end if;

  insert into public.visit_test_culture_isolates(
    tenant_id,branch_id,visit_test_id,isolate_number,organism_name,growth_description,
    colony_count,colony_count_unit,identification_method,notes,created_by_staff_id,created_by
  ) values (
    p_tenant_id,p_branch_id,p_visit_test_id,v_number,btrim(p_payload->>'organism_name'),
    nullif(btrim(coalesce(p_payload->>'growth_description','')),''),
    v_count,coalesce(nullif(btrim(p_payload->>'colony_count_unit'),''),'CFU/mL'),
    nullif(btrim(coalesce(p_payload->>'identification_method','')),''),
    nullif(btrim(coalesce(p_payload->>'notes','')),''),p_staff_id,auth.uid()
  )
  on conflict(visit_test_id,isolate_number) do update set
    organism_name=excluded.organism_name,growth_description=excluded.growth_description,
    colony_count=excluded.colony_count,colony_count_unit=excluded.colony_count_unit,
    identification_method=excluded.identification_method,notes=excluded.notes,
    created_by_staff_id=excluded.created_by_staff_id,created_by=excluded.created_by,updated_at=now()
  returning id into v_result_id;

  update private.offline_operation_receipts set result_ids=array[v_result_id],completed_at=now()
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id;
  return v_result_id;
end;
$function$;

create or replace function public.save_culture_susceptibility_idempotent(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_isolate_id uuid,
  p_staff_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_receipt private.offline_operation_receipts%rowtype;
  v_payload jsonb;
  v_result_id uuid;
  v_visit_status text;
  v_published boolean;
  v_test_status text;
  v_value numeric;
  v_unit text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied' using errcode='42501'; end if;
  if p_staff_id is null or not exists(
    select 1 from public.staff_directory sd where sd.id=p_staff_id
      and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required' using errcode='42501'; end if;

  select vt.status,v.status,v.is_published into v_test_status,v_visit_status,v_published
    from public.visit_test_culture_isolates i
    join public.visit_tests vt on vt.id=i.visit_test_id and vt.tenant_id=i.tenant_id and vt.branch_id=i.branch_id
    join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id and v.branch_id=vt.branch_id
   where i.id=p_isolate_id and i.tenant_id=p_tenant_id and i.branch_id=p_branch_id
   for update of v,vt,i;
  if not found then raise exception 'Culture isolate was not found for this tenant and branch'; end if;
  if v_test_status in ('completed','cancelled') or v_visit_status in ('approved','published','cancelled') or coalesce(v_published,false) then
    raise exception 'Completed or approved culture results are locked';
  end if;

  v_value:=nullif(p_payload->>'measured_value','')::numeric;
  v_unit:=nullif(btrim(coalesce(p_payload->>'measured_unit','')),'');
  if (v_value is null) <> (v_unit is null) then raise exception 'Measured value and unit must be supplied together'; end if;
  if v_value is not null and v_value<0 then raise exception 'Invalid measured value'; end if;
  if p_payload->>'interpretation' not in ('S','I','R','SDD','IE','NA','not_interpreted') then raise exception 'Invalid susceptibility interpretation'; end if;
  if p_payload->>'breakpoint_standard' not in ('CLSI','EUCAST','other') then raise exception 'Invalid breakpoint standard'; end if;
  if p_payload->>'test_method' not in ('disk_diffusion','mic','automated','gradient_diffusion','other') then raise exception 'Invalid susceptibility method'; end if;
  if coalesce(p_payload->>'qc_status','not_documented') not in ('not_documented','passed','failed') then raise exception 'Invalid QC status'; end if;
  if nullif(btrim(coalesce(p_payload->>'antimicrobial_agent','')),'') is null
    or nullif(btrim(coalesce(p_payload->>'breakpoint_edition','')),'') is null then
    raise exception 'Antimicrobial agent and breakpoint edition are required';
  end if;

  v_payload:=jsonb_build_object('kind','culture_susceptibility','isolate_id',p_isolate_id,'staff_id',p_staff_id,'payload',p_payload);
  insert into private.offline_operation_receipts(tenant_id,branch_id,operation_id,created_by,payload)
  values(p_tenant_id,p_branch_id,p_operation_id,auth.uid(),v_payload)
  on conflict(tenant_id,branch_id,operation_id) do nothing;
  select * into v_receipt from private.offline_operation_receipts
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id for update;
  if not found then raise exception 'Offline operation receipt could not be locked'; end if;
  if v_receipt.created_by is distinct from auth.uid() then raise exception 'Offline operation belongs to another user' using errcode='42501'; end if;
  if v_receipt.payload is distinct from v_payload then raise exception 'Idempotency key reused with different payload'; end if;
  if cardinality(v_receipt.result_ids)>0 then return v_receipt.result_ids[1]; end if;

  insert into public.visit_test_culture_susceptibility(
    tenant_id,branch_id,isolate_id,antimicrobial_agent,test_method,measured_value,measured_unit,
    interpretation,breakpoint_standard,breakpoint_edition,breakpoint_table,breakpoint_source_url,
    qc_status,notes,entered_by_staff_id,entered_by
  ) values (
    p_tenant_id,p_branch_id,p_isolate_id,btrim(p_payload->>'antimicrobial_agent'),p_payload->>'test_method',
    v_value,v_unit,p_payload->>'interpretation',p_payload->>'breakpoint_standard',
    btrim(p_payload->>'breakpoint_edition'),nullif(btrim(coalesce(p_payload->>'breakpoint_table','')),''),
    nullif(btrim(coalesce(p_payload->>'breakpoint_source_url','')),''),
    coalesce(p_payload->>'qc_status','not_documented'),nullif(btrim(coalesce(p_payload->>'notes','')),''),
    p_staff_id,auth.uid()
  )
  on conflict(isolate_id,antimicrobial_agent) do update set
    test_method=excluded.test_method,measured_value=excluded.measured_value,measured_unit=excluded.measured_unit,
    interpretation=excluded.interpretation,breakpoint_standard=excluded.breakpoint_standard,
    breakpoint_edition=excluded.breakpoint_edition,breakpoint_table=excluded.breakpoint_table,
    breakpoint_source_url=excluded.breakpoint_source_url,qc_status=excluded.qc_status,
    notes=excluded.notes,entered_by_staff_id=excluded.entered_by_staff_id,entered_by=excluded.entered_by,updated_at=now()
  returning id into v_result_id;

  update private.offline_operation_receipts set result_ids=array[v_result_id],completed_at=now()
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id;
  return v_result_id;
end;
$function$;

revoke all on function public.save_culture_isolate_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.save_culture_susceptibility_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_culture_isolate_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.save_culture_susceptibility_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;

commit;
