-- Fix integer result validation: numeric_integer was validated as numeric above,
-- then incorrectly rejected by the trailing text/choice mode guard.
CREATE OR REPLACE FUNCTION private.validate_result_parameter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
declare
  v_snapshot jsonb;
  v_branch uuid;
  v_parameter jsonb;
  v_override jsonb;
  v_value_type text;
  v_input_mode text;
  v_choices jsonb;
  v_multi jsonb;
  v_choice text;
  v_score text;
  v_score_total numeric := 0;
  v_max_selections integer;
begin
  select technical_snapshot, branch_id into v_snapshot, v_branch
    from public.visit_tests
   where id=new.visit_test_id and tenant_id=new.tenant_id;
  if not found then raise exception 'Visit test was not found for this tenant'; end if;

  if new.entered_by_staff_id is not null and not exists (
    select 1 from public.staff_directory sd
     where sd.id=new.entered_by_staff_id and sd.tenant_id=new.tenant_id
       and sd.branch_id=v_branch and sd.is_active
  ) then raise exception 'Selected staff name does not belong to this branch'; end if;

  select p into v_parameter
    from jsonb_array_elements(coalesce(v_snapshot->'parameters','[]'::jsonb)) p
   where p->>'code'=new.parameter_code
   limit 1;
  if v_parameter is null then raise exception 'Result parameter is not part of the visit test snapshot'; end if;

  select o.reference_ranges into v_override
    from public.visit_test_parameter_range_overrides o
   where o.tenant_id=new.tenant_id and o.branch_id=v_branch
     and o.visit_test_id=new.visit_test_id and o.parameter_code=new.parameter_code;

  new.parameter_name_snapshot:=v_parameter->>'name';
  new.unit_snapshot:=v_parameter->>'unit';
  new.reference_range_snapshot:=coalesce(v_override,v_parameter->'reference_ranges','[]'::jsonb);

  v_value_type:=coalesce(v_parameter->>'value_type','numeric');
  v_input_mode:=coalesce(nullif(v_parameter->>'result_input_mode',''),
    case
      when v_value_type='numeric' and coalesce((v_parameter->>'decimal_places')::integer,2)=0 then 'numeric_integer'
      when v_value_type='numeric' then 'numeric_decimal'
      when v_value_type='boolean' then 'boolean'
      when v_value_type='choice' then 'single_choice'
      else 'text'
    end);
  v_choices:=coalesce(v_parameter->'choices','[]'::jsonb);

  if v_input_mode in ('numeric_integer','numeric_decimal') then
    if new.value_numeric is null or new.value_text is not null
       or new.value_numeric::text in ('NaN','Infinity','-Infinity') then
      raise exception 'A numeric parameter requires one finite numeric result';
    end if;
    if v_input_mode='numeric_integer' and trunc(new.value_numeric)<>new.value_numeric then
      raise exception 'This parameter only accepts a whole-number result';
    end if;
  else
    if new.value_text is null or new.value_numeric is not null then
      raise exception 'This parameter requires one text result';
    end if;
    new.value_text:=btrim(new.value_text);
    if new.value_text='' then raise exception 'A result cannot be empty'; end if;
  end if;

  if v_input_mode='numeric_comparator' then
    if new.value_text !~ '^(<=|>=|<|>)[[:space:]]*[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$' then
      raise exception 'Enter a comparator result such as <5, <=10, >300 or >=1.2';
    end if;
  elsif v_input_mode='boolean' then
    if new.value_text not in ('true','false') then
      raise exception 'A boolean result must be true or false';
    end if;
  elsif v_input_mode in ('positive_negative','single_choice','multi_choice','graded_multi_choice') then
    if jsonb_typeof(v_choices) is distinct from 'array' or jsonb_array_length(v_choices)=0 then
      raise exception 'This choice parameter must contain an allowed choices list';
    end if;
    if v_input_mode in ('positive_negative','single_choice') then
      if not exists(
        select 1 from jsonb_array_elements_text(v_choices) as choice(value)
         where choice.value=new.value_text
      ) then
        raise exception 'Result value is not one of the allowed parameter choices';
      end if;
    else
      begin
        v_multi:=new.value_text::jsonb;
      exception when others then
        raise exception 'Select one or more valid choices';
      end;
      if jsonb_typeof(v_multi) is distinct from 'array' or jsonb_array_length(v_multi)=0 then
        raise exception 'Select at least one choice';
      end if;
      if exists(
        select value from jsonb_array_elements_text(v_multi)
         group by value having count(*)>1
      ) then
        raise exception 'Duplicate choices are not allowed';
      end if;
      if v_input_mode='graded_multi_choice'
         and jsonb_typeof(v_parameter->'result_config'->'choice_scores') is distinct from 'object' then
        raise exception 'Graded choice parameters require a score mapping';
      end if;
      for v_choice in select value from jsonb_array_elements_text(v_multi) loop
        if not exists(
          select 1 from jsonb_array_elements_text(v_choices) as choice(value)
           where choice.value=v_choice
        ) then
          raise exception 'A selected value is not in the allowed parameter choices';
        end if;
        if v_input_mode='graded_multi_choice' then
          v_score:=v_parameter->'result_config'->'choice_scores'->>v_choice;
          if v_score is null or v_score !~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$' then
            raise exception 'Every selected graded choice must have a numeric score';
          end if;
          v_score_total:=v_score_total+v_score::numeric;
        end if;
      end loop;
      v_max_selections:=nullif(v_parameter->'result_config'->>'max_selections','')::integer;
      if v_max_selections is not null and jsonb_array_length(v_multi)>v_max_selections then
        raise exception 'Too many choices were selected';
      end if;
    end if;
  elsif v_input_mode not in ('text','numeric_integer','numeric_decimal') then
    raise exception 'Unsupported result input mode: %',v_input_mode;
  end if;

  return new;
end;
$function$;
