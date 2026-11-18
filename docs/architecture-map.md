# خريطة نقل الملفات — النسخة المحايدة

**قاعدة مهمة:** هذه خريطة وجهة مقترحة وليست أمر نقل فوري. كل ملف سيبقى في `source_original/` كما هو حتى يكتمل ربط صفحاته واختبارها.

| المصدر الحالي | الوجهة المقترحة | القرار / الملاحظات |
|---|---|---|
| `index.html` | `website/index.html` أو `app/public-site.html` | تحديد نقطة الدخول النهائية بعد فصل الموقع العام عن بوابة المرضى.
| `app.js` | `website/js/public-site.js` | إزالة بيانات وهوية طيبة الثابتة وربطه بخدمات عامة.
| `data.js` | `modules/catalog/` (ملف جديد) | لا ينقل كما هو؛ الكتالوج والأسعار بيانات tenant وليست بيانات ثابتة بالقالب.
| `features.js` | `website/js/features.js` | مراجعة الوظائف قبل النقل.
| `site_dynamic.js` | `website/js/cms-renderer.js` | يعاد ربطه بمخطط CMS الجديد.
| `patient_portal.js` | `portal/js/patient-portal.js` | إعادة بناء مصدر القراءة على RPC/روابط آمنة.
| `settings.html` | `website/admin/` | إدارة CMS؛ فصلها عن إعدادات التشغيل.
| `super-admin.html` | `app/platform-admin/` | ربطها بتدفق تسجيل مالك المنصة وإنشاء tenant الآمن.
| `dashboard/admin.html` | `dashboard/index.html` | الاحتفاظ بواجهة الإدارة وإعادة بناء طبقة البيانات.
| `dashboard/admin.js` | `dashboard/js/dashboard.js` | تحليل الفروع يجب أن يكون ديناميكيًا.
| `dashboard/admin.css` | `assets/css/dashboard.css` | CSS خاص بالداشبورد.
| `dashboard/styles.css`, `system/styles.css`, `styles.css` | `assets/css/` | ليست كلها نسخًا متطابقة؛ styles.css الجذر يختلف. اختبار cascade قبل الدمج.
| `system/home.html` | `app/login-or-home.html` | إعادة بناء auth/branch context.
| `system/reception.html` | `modules/reception/index.html` | تفكيك JS/CSS الداخلي تدريجيًا بعد رسم الاعتماديات.
| `system/lab.html`, `system/lab.js`, `system/lab.css` | `modules/laboratory/` و`modules/results/` | الفصل بين سير العينة وإدخال/اعتماد النتائج يحتاج فحص الوظائف أولًا.
| `system/tests_manage.html` | `modules/catalog/` | ربطه بـ tests_catalog/test_prices/test_parameters.
| `system/settings.html` | `modules/settings/` | فصل الإعدادات العامة عن CMS وإعدادات الطباعة.
| `config.js` (3 نسخ) | `config/` + `core/` | توحيد إعداد البيئة والعميل، دون تخزين tenant أو role موثوق في localStorage.
| `service-worker.js` | جذر التطبيق | إعادة بناء قائمة cache للأصول العامة فقط.
| `manifest.json` | جذر التطبيق | تصحيح الأيقونات وبيانات PWA لكل tenant/branding عند الحاجة.
| `logo.png`, `header.png` | `assets/images/` | لا تعتمد أصول طيبة كافتراضي للقالب؛ صور محايدة أو tenant assets.
| `test.html` | خارج إصدار العميل إلى `tests/` أو `tools/` | يحتوي مفتاح خدمة ظاهر؛ لا ينشر، ويجب تدوير المفتاح إن كان فعالًا.
