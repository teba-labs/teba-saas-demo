begin;

-- Preserve the age exactly as entered at reception (days / months / years).
-- age_years remains the normalized compatibility value used by reference-range logic.
alter table public.patients
  alter column age_years type numeric(8,4) using age_years::numeric(8,4);

alter table public.patients
  add column if not exists age_value numeric(8,2),
  add column if not exists age_unit text not null default 'years';

update public.patients
set age_value = age_years,
    age_unit = 'years'
where age_value is null and age_years is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'patients_age_unit_check'
      and conrelid = 'public.patients'::regclass
  ) then
    alter table public.patients
      add constraint patients_age_unit_check
      check (age_unit in ('days','months','years'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'patients_age_value_check'
      and conrelid = 'public.patients'::regclass
  ) then
    alter table public.patients
      add constraint patients_age_value_check
      check (
        age_value is null
        or (
          age_value >= 0
          and (
            (age_unit = 'days' and age_value <= 43800)
            or (age_unit = 'months' and age_value <= 1440)
            or (age_unit = 'years' and age_value <= 120)
          )
        )
      );
  end if;
end $$;

commit;
