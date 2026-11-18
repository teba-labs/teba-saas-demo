# تقرير مطابقة مصدر التطوير مع Supabase TEST — 19 نوفمبر 2026

## نطاق الفحص
- المشروع: `hgqwpykeazuzceeiumjg` (TEST فقط).
- نوع الفحص: قراءة metadata ومخطط ودوال ومحفزات؛ لم يتم تنفيذ أي كتابة أو DDL أو نشر.
- المصدر المقارن: فرع `feature-completion/owner-setup` في المستودع `teba-labs/teba-saas-demo`.

## نتيجة سجل migrations
- أداة Supabase `list_migrations` أعادت قائمة فارغة.
- جدول `public.schema_migrations` يحتوي سجلًا واحدًا فقط: `1.0.0 — Initial Taiba Smart Lab multi-tenant schema`.
- في المقابل، قاعدة TEST تحتوي جداول ودوال ومحفزات من تغييرات متعددة. لذلك لا يجوز تشغيل migrations 001–016 بالتتابع عشوائيًا أو افتراض أن غيابها من سجل الأداة يعني أن كل محتواها غائب.

## فروق مؤكدة بين TEST والمصدر الجديد

| العنصر | حالة TEST وقت الفحص | التغيير المصدري المقترح |
|---|---|---|
| `staff_directory.auth_user_id` | العمود غير موجود | migration 014 تضيف الربط الفريد بين اسم الموظف وحساب Auth |
| `visit_tests.completed_by_staff_id` | العمود غير موجود | migration 013 تضيف هوية من أنهى التحليل |
| `visit_tests.completed_at` | العمود غير موجود | migration 013 تضيف وقت الإنهاء |
| `complete_visit_test_atomic` | غير موجودة | migration 013 |
| `approve_visit_atomic` | غير موجودة | migration 013 |
| `owner_assign_branch_employee` | غير موجودة | migration 014 |
| `owner_set_branch_employee_active` | غير موجودة | migration 014 |
| `private.enforce_authenticated_staff_identity` | غير موجودة | migration 015 |
| `list_branch_outstanding_balances` | غير موجودة | migration 016 |

## عناصر موجودة بالفعل في TEST ويجب الحفاظ عليها
- RPCs موجودة: `save_draft_results_atomic`, `correct_published_result`, `publish_report_version`, `record_patient_payment`.
- حقول تدقيق موجودة بالفعل في عدة جداول، ومنها `visits.approved_by_staff_id/approved_at`, `payments.received_by_staff_id`, `expenses.spent_by_staff_id`, `branch_workdays.opened_by_staff_id/closed_by_staff_id`, و`report_versions.published_by_staff_id`.
- توجد محفزات قائمة لسجل التدقيق، دفتر الأستاذ، حماية لقطات التحليل، التحقق من بارامترات النتائج، تصحيح النتائج المنشورة، وحماية نشر الزيارة.
- `private.can_access_branch` موجودة وتتحقق من عضوية المالك أو عضوية الموظف النشطة في الفرع؛ لكنها لا تفحص حاليًا `branches.is_active` أو حالة الاشتراك. لا نغير هذا السلوك ضمن دفعة الموظفين دون قرار مستقل لأنه قد يتعارض مع سياسة استمرار الأوفلاين.

## Edge Functions
- المنشور في TEST حاليًا: `patient-portal-lookup` و`publish-report`.
- `invite-branch-employee` موجودة في مصدر الفرع و`supabase/config.toml`، لكنها غير منشورة على TEST.
- تحتاج أسرار النطاقات ورابط إعادة التوجيه قبل النشر: `STAFF_INVITE_ALLOWED_ORIGINS` و`STAFF_INVITE_REDIRECT_URL`. لا تضاف مفاتيح الخدمة إلى المتصفح.

## ترتيب تطبيق مرشحات التطوير بعد الموافقة
1. migration 013: حقول تدقيق انتقالات النتائج والدوال الذرية وحواجز التحديث المباشر.
2. migration 014: عمود ربط Auth ودوال دعوة/تعطيل الموظف.
3. migration 015: فرض أن الموظف لا يسجل العملية بهوية زميله.
4. migration 016: كشف المديونيات للفرع مع استبعاد الزيارات الملغاة.
5. نشر Edge Function `invite-branch-employee` بعد ضبط الأسرار واختبار دعوة/ربط/تعطيل.

هذا ترتيب مرشحات التطوير، وليس تصريحًا بتطبيقها. قبل التنفيذ يجب توليد خطة SQL idempotent تراعي الموجود فعلًا، وفحص أسماء القيود والمحفزات والدوال المتعارضة، وأخذ نسخة احتياطية قابلة للاستعادة.

## القرار
**لا تطبيق ولا نشر الآن.** نحتاج موافقة منفصلة بعد عرض خطة المطابقة النهائية. لا تتغير `main` ولا النسخة المنشورة ضمن هذه الخطوة.
