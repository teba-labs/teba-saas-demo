-- 106: Store date of birth alongside the existing flexible age value/unit.
begin;
alter table public.patients add column if not exists date_of_birth date;
comment on column public.patients.date_of_birth is
  'Optional date of birth captured at reception; age_value/age_unit remain as the operational snapshot for visit interpretation.';
commit;
