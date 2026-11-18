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


## اكتشاف تكامل مهم بعد إعداد التقرير الأولي — 19 نوفمبر 2026
ظهر أثناء مراجعة GitHub أن هناك فرعًا آخر مفتوحًا في Pull Request رقم 1:
- الفرع: `cloud-hardening-2026-11-18`
- الحالة: Pull Request مفتوح ومسودة (Draft)، غير مدموج في `main`.
- وصف الـPR وسجلات التطوير توضح أن تغييرات TEST السابقة تضمنت migrations 012–016 بأسماء ووظائف مختلفة عن migrations 012–016 في فرع `feature-completion/owner-setup`.
- التغييرات المسجلة على فرع cloud-hardening:
  - 012: تقييد تنفيذ دالة trigger خاصة بالتقارير.
  - 013: تحصيل المديونيات عبر الفروع.
  - 014: أسعار التحاليل الخاصة بكل فرع.
  - 015: تقوية إعادة محاولات تحصيل الدفعات بين الفروع.
  - 016: الحد الذري لمحاولات بوابة المريض.
- فحص TEST قراءة فقط أكد وجود `consume_patient_portal_attempt` و`set_branch_test_price`، ووجود `payments.origin_branch_id`، وهي أدلة متسقة مع جزء من تغييرات cloud-hardening.
- في المقابل، فرع `feature-completion/owner-setup` يحمل migrations 013–016 لأعمال مختلفة: انتقالات النتائج، ربط Auth للموظفين، فرض هوية المنفذ، وكشف المديونيات.
- الفرعان متباعدان؛ لا يجوز دمجهما أو تطبيق migrations الجديدة كما هي قبل تسوية التعارضات. كذلك يوجد تعارض محتمل حول migration 012 الخاصة ببوابة المريض بين تاريخ المصدر الحالي وتاريخ cloud-hardening.

## القرار المصحح
- تقرير drift الأولي كان صحيحًا في أن migrations الخاصة بربط الموظفين وانتقالات النتائج غير موجودة في TEST، لكنه لم يكن قد رصد بعد تاريخ cloud-hardening الموازي.
- لا يجوز القول إن TEST لم تطبق migrations 012–016؛ الأدق أن سجل migration القياسي/المخصص لا يعكس التاريخ الكامل، بينما توجد آثار مؤكدة لبعض تغييرات 012–016 من فرع cloud-hardening.
- **يُوقف أي تطبيق لـmigrations 012–016 من فرع owner-setup.** يلزم أولًا إعداد فرع تكامل يجمع تغييرات cloud-hardening مع تحديثات owner-setup، ويعيد ترتيب/ترقيم migrations دون فقد تاريخها أو تكرارها.
- لا يوجد نشر جديد أو SQL كتابة خلال هذه المراجعة.


## تحديث نهائي بعد التكامل — 19 نوفمبر 2026
تمت تسوية تضارب الترقيم الذي اكتُشف بين فرعي cloud-hardening وowner-setup في فرع موحد. migrations 012–016 من cloud-hardening، و017–020 من owner-setup، و021 لإصلاح حقول actor الاختيارية قبل تنفيذ الإجراء. تم تطبيق وتسجيل 012–021 على TEST؛ لم يحدث حذف بيانات تشغيل.
فشل أول تطبيق لـ013 بسبب delimiter غير مكتمل في DO block (`do $`)، وتم إصلاح الملف إلى `do $$ ... end $$;` ثم تطبيقه بنجاح. فشل أول تطبيق لـ017 بسبب استخدام composite row variable ضمن INTO متعدد العناصر؛ تم إصلاح ترتيب الأقفال إلى قفل الزيارة ثم التحليل في استعلامين متوافقين، ثم تطبيقه بنجاح.
أظهر اختبار transaction مؤقت أن migration 019 احتاجت استثناء حقول الاعتماد/الإكمال/الإغلاق التي تكون null طبيعيًا عند الإنشاء؛ أضيفت migration 021 للسماح بها عند INSERT فقط مع بقاء الحقول المطلوبة للتحرك الفعلي محكومة بهوية الموظف. نجحت بعدها تجربة نتائج كاملة ثم ROLLBACK.
**النتيجة:** لا توجد الآن migrations 012–022 معلقة على TEST. لا يزال `public.schema_migrations` يعرض baseline `1.0.0` فقط، بينما سجل Supabase migrations القياسي يعرض 012–021؛ يجب تسوية وتوثيق 001–011 قبل تشغيل أدوات db push الآلية.


## آخر تحديث — migration 022
أضيفت migration 022 لإصلاح ترتيب إعادة تفعيل الموظف: تفعيل عضوية المعمل أولًا ثم عضوية الفرع، بينما يظل التعطيل بالترتيب العكسي. تم تطبيقها وتسجيلها في TEST. اختبار SQL مؤقت لربط الحساب ثم التعطيل ثم إعادة التفعيل نجح، مع ROLLBACK في النهاية.
