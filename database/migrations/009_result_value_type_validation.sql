-- Batch 21: enforce catalog result value types against each visit's frozen snapshot.
-- Apply only after reviewing the migration and confirming the intended TEST project.

create or replace function private.validate_result_parameter()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_snapshot jsonb;
  v_branch uuid;
  v_parameter jsonb;
  v_value_type text;
  v_choices jsonb;
begin
  select technical_snapshot, branch_id
    into v_snapshot, v_branch
    from public.visit_tests
   where id = new.visit_test_id
     and tenant_id = new.tenant_id;

  if not found then
    raise exception 'Visit test was not found for this tenant';
  end if;

  if new.entered_by_staff_id is not null and not exists (
    select 1 from public.staff_directory sd
     where sd.id = new.entered_by_staff_id
       and sd.tenant_id = new.tenant_id
       and sd.branch_id = v_branch
       and sd.is_active
  ) then
    raise exception 'Selected staff name does not belong to this branch';
  end if;

  select p into v_parameter
    from jsonb_array_elements(coalesce(v_snapshot->'parameters', '[]'::jsonb)) p
   where p->>'code' = new.parameter_code
   limit 1;

  if v_parameter is null then
    raise exception 'Result parameter is not part of the visit test snapshot';
  end if;

  -- Report fields are always copied from the immutable visit snapshot.
  new.parameter_name_snapshot := v_parameter->>'name';
  new.unit_snapshot := v_parameter->>'unit';
  new.reference_range_snapshot := coalesce(v_parameter->'reference_ranges', '[]'::jsonb);

  v_value_type := coalesce(v_parameter->>'value_type', 'numeric');
  if v_value_type not in ('numeric', 'text', 'boolean', 'choice') then
    raise exception 'Unsupported value type in visit test snapshot';
  end if;

  if v_value_type = 'numeric' then
    if new.value_numeric is null or new.value_text is not null
       or new.value_numeric::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'A numeric parameter requires one finite numeric result';
    end if;
  else
    if new.value_text is null or new.value_numeric is not null then
      raise exception 'A text, boolean or choice parameter requires only a text result';
    end if;
    new.value_text := btrim(new.value_text);
    if new.value_text = '' then
      raise exception 'A text result cannot be empty';
    end if;
  end if;

  if v_value_type = 'boolean' and new.value_text not in ('true', 'false') then
    raise exception 'A boolean result must be true or false';
  end if;

  if v_value_type = 'choice' then
    v_choices := v_parameter->'choices';
    if jsonb_typeof(v_choices) is distinct from 'array' then
      raise exception 'Choice parameter snapshot must contain a choices array';
    end if;
    if not exists (
      select 1
        from jsonb_array_elements_text(v_choices) as choice(value)
       where choice.value = new.value_text
    ) then
      raise exception 'Result value is not one of the allowed parameter choices';
    end if;
  end if;

  return new;
end;
$$;
