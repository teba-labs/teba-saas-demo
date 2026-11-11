/* =====================================================
   TEBA LABS - Patient Portal (v2.1 - Demo White Label)
   بوابة استعلام المرضى عن النتائج
   ===================================================== */

(function(){
    'use strict';

    // تأكيد وجود الإعدادات
    if (typeof TEBA_CONFIG === 'undefined') {
        console.error("TEBA_CONFIG is missing.");
        return;
    }

    const supabaseUrl = TEBA_CONFIG.supabase.url;
    const supabaseKey = TEBA_CONFIG.supabase.key;
    const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

    // دالة مساعدة لتنظيف النصوص للمقارنة
    function normalizeText(str) {
        if (!str) return '';
        return str.trim().replace(/\s+/g, ' ').toLowerCase();
    }

    // دالة عرض التنبيهات (Toast)
    function showToastMsg(msg, type = 'info') {
        if (window.showToast) {
            window.showToast(msg, type);
        } else {
            alert(msg);
        }
    }

    // =====================================================
    // 1. جلب نتيجة المريض
    // =====================================================
    window.fetchPatientResult = async function() {
        const nameInput = document.getElementById('rName');
        const idInput = document.getElementById('rId');
        const modal = document.getElementById('resultModal');
        const printArea = document.getElementById('print-area');
        
        if (!nameInput || !idInput || !modal || !printArea) return;

        const patientName = nameInput.value.trim();
        const visitId = idInput.value.trim();

        if (!patientName || !visitId) {
            showToastMsg('⚠️ يرجى إدخال الاسم ورقم الزيارة', 'warning');
            return;
        }

        // تغيير شكل المودال ليعرض "جاري التحميل"
        printArea.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <div style="font-size: 2rem; margin-bottom: 15px;">⏳</div>
                <h3 style="color: #333;">جاري البحث عن النتيجة...</h3>
            </div>`;
        modal.style.display = 'block';

        try {
            // 1. البحث عن الزيارة (بناءً على رقم الزيارة والـ Tenant)
            const { data: visitData, error: visitErr } = await _supabase
                .from('visits')
                .select('visit_id, is_published, patient_id, visit_date, patients(name, age, age_type, gender, doctor_name)')
                .eq('tenant_id', TEBA_CONFIG.tenant.id)
                .eq('visit_id', visitId)
                .single();

            if (visitErr || !visitData) {
                throw new Error('لم يتم العثور على زيارة بهذا الرقم.');
            }

            // 2. التأكد إن النتيجة تم نشرها
            if (!visitData.is_published) {
                throw new Error('نتيجة هذه الزيارة لم يتم نشرها بعد. يرجى المحاولة لاحقاً أو التواصل مع المعمل.');
            }

            // 3. التأكد إن الاسم اللي المريض كتبه يطابق الاسم اللي في السيستم
            const dbPatientName = normalizeText(visitData.patients.name);
            const inputPatientName = normalizeText(patientName);
            
            if (dbPatientName !== inputPatientName && !dbPatientName.includes(inputPatientName)) {
                throw new Error('الاسم المدخل لا يطابق رقم الزيارة. يرجى التأكد من كتابة الاسم كما هو في الفاتورة.');
            }

            // 4. جلب التحاليل والنتائج
            const { data: vtData, error: vtErr } = await _supabase
                .from('visit_tests')
                .select('id, test_code, price_at_time, is_cancelled')
                .eq('tenant_id', TEBA_CONFIG.tenant.id)
                .eq('visit_id', visitId);

            if (vtErr) throw vtErr;

            const activeVTs = vtData.filter(vt => vt.is_cancelled !== true);
            
            if (activeVTs.length === 0) {
                throw new Error('لا توجد تحاليل مسجلة لهذه الزيارة.');
            }

            const vtIds = activeVTs.map(v => v.id);

            // جلب النتائج (test_results) وجلب بيانات التحاليل من الكتالوج
            const [resultsRes, catalogRes] = await Promise.all([
                _supabase.from('test_results').select('visit_test_id, results_data').in('visit_test_id', vtIds).eq('tenant_id', TEBA_CONFIG.tenant.id),
                _supabase.from('tests_catalog').select('code, name, parameters, unit').eq('tenant_id', TEBA_CONFIG.tenant.id)
            ]);

            if (resultsRes.error) throw resultsRes.error;
            if (catalogRes.error) throw catalogRes.error;

            const resultsMap = {};
            resultsRes.data.forEach(r => {
                resultsMap[r.visit_test_id] = r.results_data;
            });

            const catalogMap = {};
            catalogRes.data.forEach(c => {
                catalogMap[c.code] = c;
            });

            // 5. تجهيز الـ HTML للتقرير
            renderReport(visitData, activeVTs, resultsMap, catalogMap);

        } catch (error) {
            console.error("Error fetching result:", error);
            printArea.innerHTML = `
                <div style="text-align: center; padding: 50px; color: #d32f2f;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">❌</div>
                    <h3 style="margin-bottom: 10px;">عذراً، لم نتمكن من عرض النتيجة</h3>
                    <p style="font-size: 1rem;">${error.message}</p>
                </div>`;
        }
    };

    // =====================================================
    // 2. بناء شكل التقرير (Print Area)
    // =====================================================
    function renderReport(visit, vTests, resultsMap, catalogMap) {
        const printArea = document.getElementById('print-area');
        const patient = visit.patients;
        const reqDate = visit.visit_date ? new Date(visit.visit_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB');
        const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

        let ageStr = patient.age + ' Years';
        if(patient.age_type === 'Months') ageStr = patient.age + ' Months';
        if(patient.age_type === 'Days') ageStr = patient.age + ' Days';

        // الـ Header
        let html = `
            <div class="print-header" style="display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px;">
                <div style="text-align: left;">
                    <h1 style="margin: 0; color: #000; font-size: 28px; font-weight: 900;">${TEBA_CONFIG.lab.nameEn || 'LAB SYSTEM'}</h1>
                    <p style="margin: 2px 0 0 0; font-size: 14px; color: #333;">For Medical Analyzes</p>
                    <p style="margin: 0; font-size: 14px; color: #333;">${TEBA_CONFIG.lab.doctor || ''}</p>
                </div>
                <div style="display: flex; justify-content: flex-end;">
                    <img src="header.png" alt="Logo" style="max-height: 90px; object-fit: contain;" onerror="this.style.display='none'">
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; border: 1.5px solid #000; padding: 10px 15px; border-radius: 4px; background: #fff; font-size: 13px; margin-bottom: 20px;">
                <div style="width: 50%; display: flex; flex-direction: column; gap: 5px;">
                    <div><strong>Patient:</strong> <span style="font-weight: bold;">${patient.name || 'Unknown'}</span></div>
                    <div><strong>Age/Gender:</strong> <span style="font-weight: bold;">${ageStr} / ${patient.gender}</span></div>
                    <div><strong>Referred By:</strong> <span style="font-weight: bold;">${patient.doctor_name || '---'}</span></div>
                </div>
                <div style="width: 50%; display: flex; flex-direction: column; gap: 5px; text-align: right; border-left: 1.5px solid #000; padding-left: 15px;">
                    <div><strong>Visit ID:</strong> <span style="font-weight: bold;">${String(visit.visit_id).padStart(4, '0')}</span></div>
                    <div><strong>Request Date:</strong> <span style="font-weight: bold;">${reqDate}</span></div>
                    <div><strong>Print Date:</strong> <span style="font-weight: bold;">${printDate}</span></div>
                </div>
            </div>
        `;

        // الجداول
        let singlesRows = '';
        let profilesData = [];

        vTests.forEach(vt => {
            const catalog = catalogMap[vt.test_code] || { name: vt.test_code, code: vt.test_code, parameters: [] };
            const savedData = resultsMap[vt.id] || {};
            
            let params = catalog.parameters;
            if (typeof params === 'string') {
                try { params = JSON.parse(params); } catch(e) { params = []; }
            }
            if (!Array.isArray(params)) params = [];

            const isProfile = catalog.name.includes('Profile') || params.length > 1 || (params.length === 1 && params[0].name !== 'Result');
            
            let hasTestData = false;
            let testRows = '';

            if (isProfile) {
                params.forEach(param => {
                    const val = savedData[param.name]?.value;
                    const phase = savedData[param.name]?.phase;
                    const range = savedData[param.name]?.customRange || param.normal_text || (param.ranges && param.ranges[0] ? `${param.ranges[0].min} - ${param.ranges[0].max}` : '-');
                    
                    if (val) {
                        hasTestData = true;
                        let displayParamName = param.label || param.name;
                        if (phase) displayParamName += ` (${phase})`;
                        
                        // تحديد الحالة (High/Low/Normal)
                        let flagStr = '';
                        const num = parseFloat(val); 
                        const match = range.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
                        if (!isNaN(num) && match) {
                            const min = parseFloat(match[1]), max = parseFloat(match[2]);
                            if (num < min) flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #d32f2f;">Low</span>`;
                            else if (num > max) flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #d32f2f;">High</span>`;
                            else flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #2e7d32;">Normal</span>`;
                        }

                        testRows += `<tr><td style="border-bottom: 1px solid #ccc; padding: 8px 6px;">${displayParamName}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center; font-weight:bold;">${val}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${flagStr}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${param.unit || ''}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${range}</td></tr>`;
                    }
                });
                if (hasTestData) profilesData.push({ name: catalog.name, rows: testRows });
            } else {
                const param = params[0] || { name: 'Result' };
                const val = savedData[param.name]?.value || savedData['Result']?.value;
                const range = savedData[param.name]?.customRange || savedData['Result']?.customRange || '-';
                
                if (val) {
                    let flagStr = '';
                    const num = parseFloat(val); 
                    const match = range.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
                    if (!isNaN(num) && match) {
                        const min = parseFloat(match[1]), max = parseFloat(match[2]);
                        if (num < min) flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #d32f2f;">Low</span>`;
                        else if (num > max) flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #d32f2f;">High</span>`;
                        else flagStr = `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #2e7d32;">Normal</span>`;
                    }
                    singlesRows += `<tr><td style="border-bottom: 1px solid #ccc; padding: 8px 6px;">${catalog.name}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center; font-weight:bold;">${val}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${flagStr}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${param.unit || catalog.unit || ''}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${range}</td></tr>`;
                }
            }
        });

        if (singlesRows !== '') {
            html += `<div style="margin-bottom: 25px;">
                <h3 style="margin: 0 0 10px 0; background: #eee; padding: 8px 12px; border-left: 4px solid #000;">SINGLE TESTS</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead><tr style="background: #000; color: #fff;"><th style="padding: 8px 6px; text-align:left;">Test Name</th><th style="padding: 8px 6px; text-align:center;">Result</th><th style="padding: 8px 6px; text-align:center;">State</th><th style="padding: 8px 6px; text-align:center;">Unit</th><th style="padding: 8px 6px; text-align:center;">Ref. Range</th></tr></thead>
                    <tbody>${singlesRows}</tbody>
                </table>
            </div>`;
        }

        profilesData.forEach(profile => {
            html += `<div style="margin-bottom: 25px;">
                <h3 style="margin: 0 0 10px 0; background: #eee; padding: 8px 12px; border-left: 4px solid #000;">${profile.name}</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead><tr style="background: #000; color: #fff;"><th style="padding: 8px 6px; text-align:left;">Test Name</th><th style="padding: 8px 6px; text-align:center;">Result</th><th style="padding: 8px 6px; text-align:center;">State</th><th style="padding: 8px 6px; text-align:center;">Unit</th><th style="padding: 8px 6px; text-align:center;">Ref. Range</th></tr></thead>
                    <tbody>${profile.rows}</tbody>
                </table>
            </div>`;
        });

        // الـ Footer (تم تعديله ليكون ديناميكي وليس به أسماء فروعك)
        html += `<div style="display: flex; justify-content: space-between; border-top: 2px solid #000; padding-top: 10px; font-size: 13px; color: #000; margin-top: 30px;">
            <div style="text-align: left; direction: ltr; font-weight: bold; line-height: 1.8;">
                <p style="margin: 0;">📞 ${TEBA_CONFIG.lab.phone || ''}</p>
                <p style="margin: 0;">📱 ${TEBA_CONFIG.lab.whatsapp || ''}</p>
            </div>
            <div style="text-align: right; direction: rtl; font-weight: bold; line-height: 1.8;">
                <p style="margin: 0;">${TEBA_CONFIG.lab.address || 'العنوان'}</p>
                <p style="margin: 0;">${TEBA_CONFIG.lab.name || 'معمل التحاليل'}</p>
            </div>
        </div>`;

        printArea.innerHTML = html;
    }

    // =====================================================
    // 3. تحميل النتيجة كـ PDF
    // =====================================================
    window.downloadPDF = function() {
        const element = document.getElementById('print-area');
        if (!element || element.innerHTML.includes('جاري البحث') || element.innerHTML.includes('عذراً')) {
            showToastMsg('لا توجد نتيجة صالحة لتحميلها', 'warning');
            return;
        }

        if (typeof html2pdf === 'undefined') {
            showToastMsg('جاري تحميل مكتبة PDF، يرجى المحاولة بعد قليل...', 'info');
            return;
        }

        const opt = {
            margin: 10,
            filename: `Result_${new Date().toISOString().slice(0,10)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        showToastMsg('جاري تجهيز الملف...', 'info');
        
        html2pdf().set(opt).from(element).save().then(() => {
            showToastMsg('تم تحميل النتيجة بنجاح ✅', 'success');
        }).catch(err => {
            console.error("PDF Error:", err);
            showToastMsg('حدث خطأ أثناء تحميل الـ PDF', 'error');
        });
    };

})();/* ============= 4. FEATURED TESTS ============= */
const FEATURED_NAMES = [
  "صورة دم كاملة","سرعة ترسيب","سكر صائم","سكر عشوائي","سكر تراكمي",
  "إنزيم الكبد ALT","إنزيم الكبد AST","يوريا","كرياتينين","حمض البوليك",
  "كوليسترول","دهون ثلاثية","كوليسترول نافع","كوليسترول ضار","دهون كاملة",
  "هرمون الغدة الدرقية","هرمون T3 الحر","هرمون T4 الحر","فيتامين د3",
  "فيتامين B12","مخزون الحديد","بروتين سي التفاعلي CRP","ASOT",
  "تحليل بول","تحليل براز","دلالة البروستاتا الكلي"
];

/* ============= 5. PACKAGES (White Label Defaults) ============= */
const PACKAGES = [
  {
    id:'full', icon:'🩺', name:'باقة الفحص الشامل',
    desc:'فحص عام متكامل لأجهزة الجسم الأساسية',
    image:'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600&h=400&fit=crop&q=80',
    featured:true, count:16,
    tests:['صورة دم كاملة','بروتين سي التفاعلي CRP','سكر صائم','سكر تراكمي','إنزيم الكبد ALT','إنزيم الكبد AST','كرياتينين','يوريا','دهون كاملة','هرمون الغدة الدرقية']
  },
  {
    id:'sugar', icon:'🍬', name:'باقة السكر والدهون',
    desc:'متابعة شاملة للسكر ومستوى الدهون ووظائف الأعضاء',
    image:'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&h=400&fit=crop&q=80',
    count:15,
    tests:['سكر صائم','سكر عشوائي','سكر تراكمي','دهون كاملة','صورة دم كاملة','تحليل بول','إنزيم الكبد ALT','إنزيم الكبد AST','يوريا','كرياتينين']
  },
  {
    id:'thyroid', icon:'🦋', name:'باقة صحة الغدة الدرقية',
    desc:'تقييم شامل لوظائف الغدة الدرقية والمناعة الذاتية',
    image:'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=600&h=400&fit=crop&q=80',
    count:6,
    tests:['هرمون الغدة الدرقية','هرمون T3 الحر','هرمون T4 الحر','هرمون T3 الكلي','هرمون T4 الكلي','أجسام مضادة للغدة TPO']
  },
  {
    id:'pregnancy', icon:'🤰', name:'باقة متابعة الحمل',
    desc:'الفحوصات الأساسية لمتابعة صحتك وصحة الجنين',
    image:'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=600&h=400&fit=crop&q=80',
    count:9,
    tests:['صورة دم كاملة','فصيلة الدم','عامل RH','سكر عشوائي','تحليل بول','فيروس بي HBs Ag','فيروس سي HCV','فيروس نقص المناعة HIV','هرمون الغدة الدرقية']
  }
];

const PACKAGE_DISCOUNT = 25;

/* ============= 6. TEST PREPARATION ============= */
const TEST_PREPARATION = {
  "صورة دم كاملة":{conditions:"لا يشترط الصيام",notes:"يمكن سحب العينة في أي وقت. أبلغ الطبيب بالأدوية التي تستخدمها.",source:"Mayo Clinic / MedlinePlus"},
  "سرعة ترسيب":{conditions:"لا يشترط الصيام",notes:"يمكن إجراء التحليل في أي وقت.",source:"MedlinePlus"},
  "هيموجلوبين":{conditions:"لا يشترط الصيام",notes:"يمكن إجراء التحليل في أي وقت.",source:"MedlinePlus"},
  "سكر صائم":{conditions:"الصيام 8-12 ساعة",notes:"الماء مسموح. تجنب التدخين قبل الفحص. يُفضل صباحًا.",source:"Mayo Clinic / MSD Manuals"},
  "سكر عشوائي":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت بغض النظر عن الأكل.",source:"Mayo Clinic"},
  "سكر بعد الأكل":{conditions:"بعد ساعتين من الطعام",notes:"يُسحب بعد ساعتين بالضبط من بداية تناول الطعام.",source:"Mayo Clinic"},
  "سكر تراكمي":{conditions:"لا يشترط الصيام",notes:"يعكس متوسط السكر في آخر 2-3 شهور.",source:"Mayo Clinic"},
  "أنسولين صائم":{conditions:"الصيام 8-12 ساعة",notes:"الماء مسموح.",source:"Mayo Clinic"},
  "كوليسترول":{conditions:"الصيام 9-12 ساعة",notes:"تجنب الكحول 24 ساعة قبل التحليل.",source:"Mayo Clinic"},
  "دهون ثلاثية":{conditions:"الصيام 12-14 ساعة",notes:"تجنب الكحول تمامًا 24 ساعة قبل.",source:"Mayo Clinic / MSD Manuals"},
  "دهون كاملة":{conditions:"الصيام 9-12 ساعة",notes:"يشمل الكوليسترول والدهون الثلاثية و HDL و LDL. تجنب الكحول 24 ساعة.",source:"Mayo Clinic"},
  "هرمون الغدة الدرقية":{conditions:"لا يشترط الصيام",notes:"يُفضل نفس الوقت من اليوم للمقارنة.",source:"MedlinePlus"},
  "هرمون T3 الكلي":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "هرمون T4 الكلي":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "هرمون T3 الحر":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "هرمون T4 الحر":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "أجسام مضادة للغدة TPO":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "فيتامين د3":{conditions:"لا يشترط الصيام",notes:"أخبر الطبيب بالفيتامينات والمكملات.",source:"MedlinePlus"},
  "فيتامين B12":{conditions:"لا يشترط الصيام",notes:"أخبر الطبيب بمكملات B12.",source:"MSD Manuals"},
  "حمض الفوليك":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "حديد":{conditions:"لا يشترط الصيام",notes:"يُفضل صباحًا. أخبر الطبيب بمكملات الحديد.",source:"Mayo Clinic"},
  "مخزون الحديد":{conditions:"لا يشترط الصيام",notes:"يقيس الحديد المخزون.",source:"Mayo Clinic"},
  "إنزيم الكبد ALT":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"تجنب الكحول 24 ساعة. المجهود الشديد يرفع الإنزيم.",source:"Mayo Clinic"},
  "إنزيم الكبد AST":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"تجنب الكحول 24 ساعة.",source:"Mayo Clinic"},
  "يوريا":{conditions:"لا يشترط الصيام",notes:"اشرب كمية كافية من الماء.",source:"Mayo Clinic"},
  "كرياتينين":{conditions:"لا يشترط الصيام",notes:"تجنب الأكل الكثير من اللحوم قبل التحليل.",source:"Mayo Clinic"},
  "حمض البوليك":{conditions:"الصيام 4-6 ساعات (مستحسن)",notes:"تجنب الأطعمة الغنية بالبيورين (لحوم حمراء، مأكولات بحرية).",source:"Mayo Clinic"},
  "تحليل بول":{conditions:"لا يشترط الصيام",notes:"جمع عينة منتصف التبول في حاوية معقمة.",source:"Mayo Clinic"},
  "تحليل براز":{conditions:"لا يشترط الصيام",notes:"جمع العينة في حاوية نظيفة وجافة.",source:"Mayo Clinic"},
  "مزرعة بول":{conditions:"لا يشترط الصيام",notes:"عينة معقمة. لا تتبول 2-3 ساعات قبل.",source:"Mayo Clinic"},
  "بروتين سي التفاعلي CRP":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "CRP عالي الحساسية":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "ASOT":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "الروماتويد":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "هرمون الحمل":{conditions:"لا يشترط الصيام",notes:"يُفضل بعد غياب الدورة الشهرية.",source:"Mayo Clinic"},
  "هرمون الحمل الكمي":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"Mayo Clinic"},
  "تحليل السائل المنوي":{conditions:"الامتناع عن الجماع 2-5 أيام",notes:"تُسلّم العينة خلال ساعة. جمع في حاوية معقمة.",source:"Mayo Clinic"},
  "زمن البروثرومبين PT":{conditions:"لا يشترط الصيام",notes:"أخبر الطبيب بمميعات الدم.",source:"Mayo Clinic"},
  "تروبونين نوعي":{conditions:"لا يشترط الصيام",notes:"يُجرى في الطوارئ للنوبة القلبية.",source:"Mayo Clinic"},
  "تحليل التيفود":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "جرثومة المعدة أجسام مضادة":{conditions:"لا يشترط الصيام",notes:"أخبر الطبيب بالأدوية.",source:"Mayo Clinic"},
  "جرثومة المعدة أنتيجين":{conditions:"لا يشترط الصيام",notes:"يُفضل التوقف عن مضادات الحموضة قبل التحليل.",source:"Mayo Clinic"},
  "فيروس سي HCV":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "فيروس بي HBs Ag":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "فيروس نقص المناعة HIV":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "توكسوبلازما IgG":{conditions:"لا يشترط الصيام",notes:"مهم للنساء الحوامل.",source:"Mayo Clinic"},
  "توكسوبلازما IgM":{conditions:"لا يشترط الصيام",notes:"يدل على عدوى حديثة.",source:"Mayo Clinic"},
  "حصبة ألمانية IgG":{conditions:"لا يشترط الصيام",notes:"لتحديد المناعة.",source:"Mayo Clinic"},
  "فيروس مضخم CMV IgG":{conditions:"لا يشترط الصيام",notes:"مهم للنساء الحوامل.",source:"Mayo Clinic"},
  "دلالة البروستاتا الكلي":{conditions:"لا يشترط الصيام",notes:"يُفضل قبل الفحص الشرجي. تجنب الجماع 48 ساعة.",source:"Mayo Clinic"},
  "دلالة أورام القولون":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "دلالة أورام الكبد":{conditions:"لا يشترط الصيام",notes:"لا تحضير خاص.",source:"MedlinePlus"},
  "مقاومة الأنسولين":{conditions:"الصيام 8-12 ساعة",notes:"مع سكر صائم وأنسولين صائم.",source:"Mayo Clinic"},
  "الكورتيزول صباحاً":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"يُسحب بين 8-9 صباحًا.",source:"Mayo Clinic"},
  "الكورتيزول مساءً":{conditions:"لا يشترط الصيام",notes:"يُسحب بعد الظهر أو العصر.",source:"Mayo Clinic"},
  "هرمون الحليب":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"تجنب الجماع والرياضة 24 ساعة قبل. يُفضل صباحًا.",source:"Mayo Clinic"},
  "هرمون الذكورة الكلي":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"يُسحب صباحًا (7-10 ص).",source:"Mayo Clinic"},
  "هرمون مخزون المبيض":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي يوم من الدورة.",source:"Mayo Clinic"},
  "دي دايمر":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "هوموسيستين":{conditions:"الصيام 8-12 ساعة",notes:"يُفضل صباحًا. أخبر الطبيب بالفيتامينات.",source:"Mayo Clinic"},
  "كالسيوم كلي":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"تجنب الأطعمة الغنية بالكالسيوم قبل التحليل.",source:"Mayo Clinic"},
  "ماغنسيوم":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"تجنب المكملات 24 ساعة قبل.",source:"MedlinePlus"},
  "زنك":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"يُفضل صباحًا. تجنب مكملات الزنك 24 ساعة.",source:"MedlinePlus"},
  "فوسفور":{conditions:"الصيام 8-12 ساعة (مستحسن)",notes:"يُفضل صباحًا.",source:"Mayo Clinic"},
  "بروتين كلي":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "فصيلة الدم":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "عامل RH":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"},
  "VDRL":{conditions:"لا يشترط الصيام",notes:"يمكن إجراؤه في أي وقت.",source:"MedlinePlus"}
};/* ============= 7. MEDICAL ARTICLES ============= */
const MEDICAL_ARTICLES = [
  {id:'prep',icon:'✅',title:'أهمية الالتزام بشروط التحاليل الطبية',summary:'ليه لازم تصوم أو تمتنع عن أدوية معينة قبل التحليل؟ وليه الشروط مهمة؟',
   body:`<h4>ليه الالتزام بشروط التحليل مهم؟</h4><p>التحاليل الطبية هي أساس التشخيص السليم. لو الشروط مش متظبطة، النتيجة ممكن تطلع غلط وتأدي لتشخيص غلط أو علاج غلط. عشان كده، الالتزام بالشروط مش رفاهية، ده ضرورة.</p><h4>أمثلة على شروط مهمة:</h4><ul><li><strong>الصيام:</strong> تحاليل السكر والدهون محتاجة صيام 8-14 ساعة.</li><li><strong>الامتناع عن الأدوية:</strong> بعض الأدوية ممكن تغير نتائج التحاليل.</li><li><strong>الامتناع عن الكحول:</strong> الكحول بيأثر على وظائف الكبد والدهون.</li><li><strong>الراحة قبل التحليل:</strong> المجهود البدني الشديد ممكن يرفع إنزيمات العضلات والكبد.</li><li><strong>توقيت التحليل:</strong> بعض الهرمونات بتتغير على مدار اليوم.</li></ul><h4>إيه اللي يحصل لو مش التزمت؟</h4><p>النتيجة ممكن تطلع: عالية أو واطية بشكل غير طبيعي، مش واضحة، أو مضللة وتخلي الدكتور ياخد قرار غلط.</p><h4>نصيحة من المعمل:</h4><p>دايمًا اسأل الدكتور أو الصيدلي عن شروط التحليل قبل ما تعمله. واحنا في المعمل بنوضحلك كل الشروط لكل تحليل، عشان نضمنلك نتيجة دقيقة.</p>`,
   source:'مصادر: Mayo Clinic، MedlinePlus، MSD Manuals'},
  {id:'vitd',icon:'☀️',title:'أعراض نقص فيتامين د',summary:'إيه العلامات اللي تدل على نقص فيتامين د؟ وإيه التحاليل المطلوبة؟',
   body:`<h4>أعراض نقص فيتامين د:</h4><ul><li><strong>آلام العظام والمفاصل</strong></li><li><strong>ضعف العضلات</strong></li><li><strong>التعب والإجهاد المستمر</strong></li><li><strong>تغيرات المزاج</strong></li><li><strong>تساقط الشعر</strong></li><li><strong>بطء التئام الجروح</strong></li><li><strong>ضعف المناعة</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>فيتامين د3</strong></li><li><strong>كالسيوم كلي</strong></li><li><strong>فوسفور</strong></li><li><strong>وظائف الكلى والكبد</strong></li></ul><h4>مين الأكثر عرضة للنقص؟</h4><ul><li>كبار السن</li><li>اللي مش بيتعرضوا للشمس</li><li>النساء الحوامل والمرضعات</li><li>مرضى الكلى والكبد</li></ul><h4>العلاج:</h4><p>التعرض للشمس 15-20 دقيقة يوميًا، الأطعمة الغنية بفيتامين د، والمكملات بعد استشارة الطبيب.</p>`,
   source:'مصادر: Mayo Clinic، MedlinePlus، MSD Manuals'},
  {id:'diabetes',icon:'🍬',title:'أعراض ارتفاع السكر في الدم',summary:'إيه العلامات اللي تدل على ارتفاع السكر؟ وإيه التحاليل المطلوبة؟',
   body:`<h4>أعراض ارتفاع السكر:</h4><ul><li><strong>العطش الشديد</strong></li><li><strong>كثرة التبول</strong></li><li><strong>التعب والإجهاد</strong></li><li><strong>زغللة العين</strong></li><li><strong>فقدان الوزن</strong></li><li><strong>بطء التئام الجروح</strong></li><li><strong>تنميل في الأطراف</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>سكر صائم</strong></li><li><strong>سكر عشوائي</strong></li><li><strong>سكر تراكمي</strong></li><li><strong>أنسولين صائم</strong></li><li><strong>وظائف الكلى</strong></li><li><strong>دهون كاملة</strong></li></ul><h4>نصيحة:</h4><p>لو عندك أي من الأعراض دي، متستناش. اعمل التحاليل فورًا، لأن التشخيص المبكر بيمنع المضاعفات.</p>`,
   source:'مصادر: Mayo Clinic، MSD Manuals'},
  {id:'anemia',icon:'🩸',title:'أعراض الأنيميا (فقر الدم)',summary:'إيه أعراض الأنيميا؟ وإيه التحاليل اللي بتكشفها؟',
   body:`<h4>أعراض الأنيميا:</h4><ul><li><strong>التعب والضعف العام</strong></li><li><strong>شحوب الجلد</strong></li><li><strong>ضيق التنفس</strong></li><li><strong>الدوخة</strong></li><li><strong>الصداع المستمر</strong></li><li><strong>برودة اليدين والقدمين</strong></li><li><strong>تساقط الشعر</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>صورة دم كاملة</strong></li><li><strong>حديد ومخزون الحديد</strong></li><li><strong>سعة ارتباط الحديد</strong></li><li><strong>فيتامين B12</strong></li><li><strong>حمض الفوليك</strong></li></ul>`,
   source:'مصادر: Mayo Clinic، MSD Manuals، MedlinePlus'},
  {id:'thyroid',icon:'🦋',title:'أعراض قصور الغدة الدرقية',summary:'إيه علامات خمول الغدة الدرقية؟ وإيه التحاليل المطلوبة؟',
   body:`<h4>أعراض قصور الغدة الدرقية:</h4><ul><li><strong>التعب والإرهاق</strong></li><li><strong>زيادة الوزن</strong></li><li><strong>الإمساك</strong></li><li><strong>برودة الجسم</strong></li><li><strong>جفاف الجلد والشعر</strong></li><li><strong>بطء ضربات القلب</strong></li><li><strong>الاكتئاب</strong></li><li><strong>اضطرابات الدورة الشهرية</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>هرمون الغدة الدرقية (TSH)</strong></li><li><strong>هرمون T4 الحر</strong></li><li><strong>هرمون T3 الحر</strong></li><li><strong>أجسام مضادة للغدة</strong></li></ul>`,
   source:'مصادر: Mayo Clinic، MSD Manuals'},
  {id:'liver',icon:'🫀',title:'أعراض ارتفاع إنزيمات الكبد',summary:'إيه علامات مشاكل الكبد؟ وإيه التحاليل اللي بتكشفها؟',
   body:`<h4>أعراض ارتفاع إنزيمات الكبد:</h4><ul><li><strong>التعب والإرهاق</strong></li><li><strong>فقدان الشهية</strong></li><li><strong>الغثيان والقيء</strong></li><li><strong>اصفرار الجلد والعينين</strong></li><li><strong>ألم في البطن العلوي الأيمن</strong></li><li><strong>بول داكن اللون</strong></li><li><strong>حكة جلدية</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>ALT و AST</strong></li><li><strong>فوسفاتيز قلوي (ALP)</strong></li><li><strong>إنزيم جاما (GGT)</strong></li><li><strong>بيليروبين</strong></li><li><strong>ألبيومين وبروتين كلي</strong></li><li><strong>فيروسات الكبد B و C</strong></li></ul>`,
   source:'مصادر: Mayo Clinic، MSD Manuals'},
  {id:'kidney',icon:'🫘',title:'أعراض ارتفاع وظائف الكلى',summary:'إيه علامات مشاكل الكلى؟ وإيه التحاليل اللي بتكشفها؟',
   body:`<h4>أعراض ارتفاع وظائف الكلى:</h4><ul><li><strong>التعب والضعف العام</strong></li><li><strong>تورم القدمين والكاحلين</strong></li><li><strong>تغيرات في كمية البول</strong></li><li><strong>رغوة في البول</strong></li><li><strong>الغثيان والقيء</strong></li><li><strong>حكة جلدية</strong></li><li><strong>ارتفاع ضغط الدم</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>يوريا</strong></li><li><strong>كرياتينين</strong></li><li><strong>معدل الترشيح (GFR)</strong></li><li><strong>تحليل بول كامل</strong></li><li><strong>ألبومين مجهري</strong></li></ul><h4>نصيحة:</h4><p>مرضى السكري وضغط الدم لازم يعملوا تحاليل وظائف الكلى بشكل دوري (كل 6-12 شهر).</p>`,
   source:'مصادر: Mayo Clinic، MSD Manuals'},
  {id:'uti',icon:'🚽',title:'أعراض التهاب المسالك البولية',summary:'إيه علامات التهاب المسالك؟ وإيه التحاليل المطلوبة؟',
   body:`<h4>أعراض التهاب المسالك البولية:</h4><ul><li><strong>حرقة عند التبول</strong></li><li><strong>رغبة ملحة ومتكررة في التبول</strong></li><li><strong>بول عكر أو له رائحة نفاذة</strong></li><li><strong>دم في البول</strong></li><li><strong>ألم في منطقة الحوض</strong></li><li><strong>حمى وقشعريرة</strong></li></ul><h4>التحاليل المطلوبة:</h4><ul><li><strong>تحليل بول كامل</strong></li><li><strong>مزرعة بول</strong></li><li><strong>صورة دم كاملة</strong></li><li><strong>بروتين سي التفاعلي (CRP)</strong></li></ul>`,
   source:'مصادر: Mayo Clinic، MSD Manuals'}
];

/* ============= 8. TESTIMONIALS (Generic) ============= */
const TESTIMONIALS = [
  {name:'أحمد م.',area:'المنطقة الأولى',initial:'أ',rating:5,text:'خدمة ممتازة وسريعة. النتيجة وصلتني في نفس اليوم عبر واتساب، والتعامل كان محترم جداً.'},
  {name:'محمود ع.',area:'المنطقة الثانية',initial:'م',rating:5,text:'أخذت باقة الفحص الشامل وكانت تجربة رائعة. الفريق محترف والأسعار مناسبة جداً.'},
  {name:'سارة أ.',area:'المنطقة الثالثة',initial:'س',rating:5,text:'طلبت سحب من المنزل، وجاؤوا في الميعاد بالظبط. التحاليل كانت دقيقة والأسعار شفافة.'},
  {name:'نورهان م.',area:'المنطقة الأولى',initial:'ن',rating:5,text:'المكان نظيف والأجهزة حديثة. النتائج مضمونة ودقيقة. الأمانة والشفافية في التعامل حاجة مميزة.'}
];

/* ============= 9. TRUST BADGES ============= */
const TRUST_BADGES = [
  { icon:'🏆', title:'خبرة سنوات', subtitle:'ثقة المرضى' },
  { icon:'✅', title:'معتمد', subtitle:'من وزارة الصحة' },
  { icon:'🔬', title:'أحدث الأجهزة', subtitle:'تقنية عالمية' },
  { icon:'⚡', title:'نتائج سريعة', subtitle:'معظمها في نفس اليوم' }
];

/* ============= 10. APP CONFIG (Placeholders) ============= */
const APP_CONFIG = {
  phone: '+201000000000',
  phoneDisplay: '01000000000',
  whatsapp: '201000000000',
  whatsappDisplay: '01000000000',
  facebook: '#',
  address: 'عنوان المعمل - المحافظة',
  startYear: 2020
};

/* ============= 11. WORKING HOURS ============= */
const WORKING_HOURS = {
  branch1: {
    name: 'الفرع الأول',
    satToThu: { open: 11, close: 23 },
    friday: { open: 16, close: 22 },
    closedDay: null
  },
  branch2: {
    name: 'الفرع الثاني',
    satToThu: { open: 12, close: 24 },
    friday: null,
    closedDay: 5
  }
};

/* ============= 12. OFFER CONFIG ============= */
const OFFER_CONFIG = {
  enabled: true,
  discount: 15,
  title: 'خصم خاص للديمو',
  periodText: 'عرض تجريبي',
  startDate: '2024-01-01T00:00:00',
  endDate: '2030-12-31T23:59:59'
};

/* ============= 13. HELPER FUNCTIONS ============= */
function isNumericPrice(p){
  return /^\d+$/.test(String(p).trim());
}
function getTestByName(name){ return TESTS.find(t => t.ar === name); }
function getPackagePrice(pkg){
  let total = 0, available = 0;
  pkg.tests.forEach(name => {
    const t = getTestByName(name);
    if(t && isNumericPrice(t.price)){ total += parseInt(t.price); available++; }
  });
  return {
    total,
    available,
    hasInquiry: available < pkg.tests.length,
    discounted: Math.round(total * (1 - PACKAGE_DISCOUNT/100))
  };
}
function isOfferActive(){
  if(!OFFER_CONFIG.enabled) return false;
  const now = new Date();
  return now >= new Date(OFFER_CONFIG.startDate) && now <= new Date(OFFER_CONFIG.endDate);
}

/* ============= 14. ARABIC NORMALIZATION ============= */
function normalizeArabic(str){
  if(!str) return '';
  return str.toString().trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0600-\u06FF\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/* ============= EXPORT ============= */
window.TEBA_DATA = {
  RAW_TESTS, CAT_ICONS, TESTS, FEATURED_NAMES, PACKAGES, PACKAGE_DISCOUNT,
  TEST_PREPARATION, MEDICAL_ARTICLES, TESTIMONIALS, TRUST_BADGES,
  APP_CONFIG, WORKING_HOURS, OFFER_CONFIG,
  isNumericPrice, getTestByName, getPackagePrice, isOfferActive, normalizeArabic
};