-- 073: Explicit tenant-owned patient portal presentation settings.
begin;
alter table public.site_settings
 add column if not exists portal_settings jsonb not null default
 jsonb_build_object(
  'enabled', true,
  'title', 'بوابة نتائج التحاليل',
  'intro', 'أدخل اسم المريض ورقم الزيارة كما هو موضح في إيصال المعمل لعرض أحدث تقرير معتمد.',
  'patient_name_label', 'اسم المريض بالكامل',
  'visit_number_label', 'رقم الزيارة',
  'submit_label', 'عرض التقرير',
  'help_text', 'لا تشارك رابط التقرير مع أي شخص آخر. رابط التحميل مؤقت.',
  'accent_color', '#147c72'
 );
alter table public.site_settings
 add constraint site_settings_portal_settings_object
 check (jsonb_typeof(portal_settings) = 'object');
commit;
