/* =====================================================
   TEBA LABS - Patient Portal (v2.0 - SaaS Secure)
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
                    <h1 style="margin: 0; color: #000; font-size: 28px; font-weight: 900;">${TEBA_CONFIG.lab.nameEn || 'TEBA LABS'}</h1>
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

        // الـ Footer
        html += `<div style="display: flex; justify-content: space-between; border-top: 2px solid #000; padding-top: 10px; font-size: 13px; color: #000; margin-top: 30px;">
            <div style="text-align: left; direction: ltr; font-weight: bold; line-height: 1.8;">
                <p style="margin: 0;">📞 ${TEBA_CONFIG.lab.phone}</p>
                <p style="margin: 0;">📱 ${TEBA_CONFIG.lab.whatsapp}</p>
            </div>
            <div style="text-align: right; direction: rtl; font-weight: bold; line-height: 1.8;">
                <p style="margin: 0;">الفرع الأول: الجعافرة - الطريق العمومي - أعلى صيدلية الصحابة</p>
                <p style="margin: 0;">الفرع الثاني: بهتيم - مساكن اسكو - أمام مدرسة ابن الخطاب</p>
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
            filename: `TEBA_Result_${new Date().toISOString().slice(0,10)}.pdf`,
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

})();