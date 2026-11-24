-- Preserve the old site's public announcement ticker as editable tenant CMS content.
begin;
update public.site_settings s
set public_content = coalesce(s.public_content,'{}'::jsonb) || jsonb_build_object(
  'announcement_messages', case
    when jsonb_typeof(s.public_content->'announcement_messages')='array'
      then s.public_content->'announcement_messages'
    else '["🎉 خصم 25% على باقات الفحص الشامل — احجز الآن","📦 باقة الفحص الشامل (16 تحليل) وفر فلوسك واطمن على صحتك","🍬 باقة السكر والدهون لمتابعة صحتك باستمرار","🧪 سكر صائم: صيام 8-12 ساعة (الماء مسموح)","🧪 دهون كاملة: صيام 9-12 ساعة (تجنب الكحول)","🧪 صورة دم كاملة: مش محتاجة صيام، تقدر تعملها في أي وقت","🧪 تحليل السائل المنوي: لازم امتناع عن الجماع من 2 لـ 5 أيام","🏠 سحب من المنزل بالحجز المسبق — كلمنا واتساب","📱 استلم نتيجتك عبر واتساب بضغطة واحدة ومجاناً","🩺 معلومة: الصيام قبل تحليل السكر بيمنع قراءات خاطئة بتأثر على العلاج","🩺 معلومة: تحليل فيتامين د مهم جداً للمناعة وصحة العظام","🩺 معلومة: الكشف المبكر عن السكر بيحميك من مضاعفات خطيرة"]'::jsonb
  end,
  'announcement_enabled', case
    when s.public_content ? 'announcement_enabled'
      then (s.public_content->>'announcement_enabled')::boolean
    else true
  end
),
updated_at=now()
from public.tenants t
where s.tenant_id=t.id and t.slug='teba-labs';
commit;
