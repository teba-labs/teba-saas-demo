// =====================================================
// TEBA LABS - Lab Logic (v140 - SaaS Multi-Tenant)
// =====================================================

// ==== التحقق من تسجيل الدخول ====
if (!localStorage.getItem('teba_tenant_id')) {
    window.location.href = 'home.html';
}

const userRole = localStorage.getItem('teba_user_role');

document.addEventListener("DOMContentLoaded", function() {
    if (typeof TEBA_CONFIG !== 'undefined') {
        document.title = "المعمل الذكي | " + TEBA_CONFIG.lab.name;
        const brandInfo = document.getElementById('brandInfo');
        if(brandInfo) brandInfo.innerText = "🔬 المعمل - " + TEBA_CONFIG.lab.name;
    }
});

// ==== تهيئة السحابة ====
const _supabase = supabase.createClient(TEBA_CONFIG.supabase.url, TEBA_CONFIG.supabase.key);

// ==== تهيئة الداتابيز المحلية ====
const db = new Dexie('TebaLabOfflineDB');
db.version(4).stores({
    patients: 'id, name, phone',
    visits: 'visit_id, patient_id, branch_id, is_published, hidden_in_lab, server_id',
    visit_tests: 'id, visit_id, test_code',
    test_results: 'id, visit_test_id',
    catalog: 'code, name, price, category',
    outbox: '++id, table_name, action, payload, timestamp'
});

// ==== المتغيرات العامة ====
let allVisits = [], visitTests = [], testsCatalog = [], testResults = [];
let selectedVisitId = null;
let currentLabBranch = localStorage.getItem('teba_current_branch') || '1'; 
let isSyncing = false; 
let showHiddenVisits = false; 
let labBranchesList = []; // لتخزين الفروع

// متغيرات الطباعة
let printSettings = {
    header: "معامل طيبة للتحاليل الطبية",
    footer: "النتيجة لا تغني عن استشارة الطبيب المعالج."
};

window.customRanges = {}; 

// ==== جلب الفروع من السحابة ====
async function loadLabBranches() {
    try {
        const { data: branches, error } = await _supabase.from('branches').select('id, name').eq('tenant_id', TEBA_CONFIG.tenant.id).order('id', { ascending: true });
        if (!error && branches && branches.length > 0) {
            labBranchesList = branches;
            const branchSelect = document.getElementById('labBranch');
            if (branchSelect) {
                branchSelect.innerHTML = branches.map(b => `<option value="${b.id}">🏥 ${b.name}</option>`).join('');
                branchSelect.value = currentLabBranch;
            }
        }
    } catch(e) { console.error("Error loading lab branches:", e); }
}

// ==== تغيير الفرع (للدكتور فقط) ====
function changeLabBranch(val) {
    if (userRole !== 'admin' && userRole !== 'owner') {
        document.getElementById('labBranch').value = currentLabBranch;
        return showToast('🔒 لا تملك صلاحية تغيير الفرع', true);
    }

    currentLabBranch = val;
    localStorage.setItem('teba_current_branch', val);
    selectedVisitId = null;
    document.getElementById('singleTestsContainer').innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
    document.getElementById('profileTestsContainer').innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
    document.getElementById('btnDownloadPdf').style.display = 'none';
    document.getElementById('btnPublishVisit').style.display = 'none';
    loadData();
}

// ==========================================
// ⚙️ محرك المزامنة الشامل (Outbox) - تم تصحيح المالية
// ==========================================
async function addToOutbox(table_name, action, payload) {
    try {
        if(payload && !payload.tenant_id && table_name !== 'orders' && table_name !== 'orders_edit') {
            payload.tenant_id = TEBA_CONFIG.tenant.id;
        }
        await db.outbox.add({ table_name, action, payload, timestamp: new Date().toISOString() });
        const syncBtn = document.getElementById('syncBtn');
        if(syncBtn) syncBtn.style.display = 'flex';
    } catch(e) { console.error("Outbox Add Error", e); }
}

async function processOutbox() {
    if (!navigator.onLine) return showToast('لا يوجد اتصال بالإنترنت!', true);
    if (isSyncing) return; 
    
    isSyncing = true;
    try {
        const pending = await db.outbox.toArray();
        if (pending.length === 0) {
            const syncBtn = document.getElementById('syncBtn');
            if(syncBtn) syncBtn.style.display = 'none';
            isSyncing = false;
            return showToast('✅ لا توجد بيانات معلقة.');
        }

        const btn = document.getElementById('syncBtn');
        if(btn) btn.innerText = '⏳ جاري المزامنة...';
        let successCount = 0;
        let failCount = 0;

        pending.sort((a, b) => {
            const order = { 'orders': 1, 'orders_edit': 1, 'patients': 1, 'visits': 2, 'visit_tests': 3, 'test_results': 4, 'financial_ledger': 5, 'payments': 5, 'audit_logs': 6 };
            return (order[a.table_name] || 99) - (order[b.table_name] || 99);
        });

        for (let item of pending) {
            try {
                if (item.table_name === 'orders' || item.table_name === 'orders_edit') {
                    const order = item.payload;
                    let patientId = order.patientId;
                    
                    const { error: pErr } = await _supabase.from('patients').upsert([{
                        id: patientId, tenant_id: TEBA_CONFIG.tenant.id, name: order.patientName, 
                        phone: order.phone, age: order.age, age_type: order.age_type, 
                        gender: order.gender, doctor_name: order.doctor_name
                    }]);
                    if (pErr) throw pErr;
                    
                    const subTotal = order.cart.reduce((sum, i) => sum + i.price, 0);
                    const discountAmount = (subTotal * (order.discountPercent / 100)) + order.discountFixed;
                    let realVisitId = null;
                    let localVisit = await db.visits.get(order.tempVisitId);
                    
                    if (item.table_name === 'orders') {
                        const { data: vData, error: vErr } = await _supabase.from('visits').upsert([{
                            client_uuid: order.client_uuid,
                            tenant_id: TEBA_CONFIG.tenant.id, patient_id: patientId, branch_id: order.branch_id, 
                            total_amount: order.netTotal, paid_amount: order.paid, discount: discountAmount, status: 'Pending', visit_date: order.visit_date
                        }], { onConflict: 'client_uuid' }).select();
                        if (vErr) throw vErr;
                        realVisitId = vData[0].visit_id;
                    } else {
                        const serverIdToUpdate = localVisit && localVisit.server_id ? localVisit.server_id : order.tempVisitId;
                        const { error: vErr } = await _supabase.from('visits').update({
                            total_amount: order.netTotal, paid_amount: order.paid, discount: discountAmount
                        }).eq('visit_id', serverIdToUpdate).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        if (vErr) throw vErr;
                        realVisitId = serverIdToUpdate;
                    }
                    
                    if (order.cart.length > 0) {
                        const tests = order.cart.map(i => ({ 
                            id: i.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())), 
                            tenant_id: TEBA_CONFIG.tenant.id, visit_id: realVisitId, test_code: i.code, price_at_time: i.price, is_cancelled: false
                        }));
                        const { error: tErr } = await _supabase.from('visit_tests').upsert(tests, { onConflict: 'id' });
                        if (tErr) throw tErr;
                    }
                    
                    if (item.table_name === 'orders' && localVisit) {
                        const oldId = order.tempVisitId;
                        const newId = realVisitId;
                        
                        const updatedVisit = { ...localVisit, visit_id: newId, server_id: newId };
                        await db.visits.delete(oldId);
                        await db.visits.put(updatedVisit);
                        
                        const localVTs = await db.visit_tests.where('visit_id').equals(oldId).toArray();
                        for (let vt of localVTs) {
                            await db.visit_tests.update(vt.id, { visit_id: newId });
                        }
                        
                        const pendingOutbox = await db.outbox.toArray();
                        for (let pItem of pendingOutbox) {
                            let changed = false;
                            if (pItem.payload && pItem.payload.visit_id == oldId) {
                                pItem.payload.visit_id = newId;
                                changed = true;
                            }
                            if (pItem.payload && pItem.payload.tempVisitId == oldId) {
                                pItem.payload.tempVisitId = newId;
                                changed = true;
                            }
                            if (changed) await db.outbox.put(pItem);
                        }
                    }
                    const bc = new BroadcastChannel('teba_sync');
                    bc.postMessage({ type: 'new_order', branch_id: order.branch_id });
                } 
                else if (item.table_name === 'visit_tests') {
                    if (item.action === 'INSERT') {
                        const { data, error } = await _supabase.from('visit_tests').upsert([item.payload], { onConflict: 'id' }).select();
                        if (error) throw error;
                        if(data && data.length > 0) {
                            const oldId = item.payload.id;
                            const newId = data[0].id;
                            if (oldId !== newId) {
                                await db.visit_tests.update(oldId, { id: newId });
                                const localResult = await db.test_results.where('visit_test_id').equals(oldId).first();
                                if(localResult) {
                                    await db.test_results.update(localResult.id, { visit_test_id: newId });
                                }
                                const pendingResults = await db.outbox.where('table_name', 'test_results').toArray();
                                for(let res of pendingResults) {
                                    if(res.payload.visit_test_id == oldId) {
                                        res.payload.visit_test_id = newId;
                                        await db.outbox.put(res);
                                    }
                                }
                            }
                        }
                    } else if (item.action === 'UPDATE') {
                        const { error } = await _supabase.from('visit_tests').update(item.payload).eq('id', item.payload.id).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        if (error) throw error;
                    } else if (item.action === 'DELETE') {
                        await _supabase.from('visit_tests').delete().eq('id', item.payload.id).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        await _supabase.from('test_results').delete().eq('visit_test_id', item.payload.id).eq('tenant_id', TEBA_CONFIG.tenant.id);
                    }
                }
                else if (item.table_name === 'test_results') {
                    const { error } = await _supabase.from('test_results').upsert({
                        tenant_id: TEBA_CONFIG.tenant.id,
                        visit_test_id: item.payload.visit_test_id, 
                        results_data: item.payload.results_data
                    }, { onConflict: 'visit_test_id' });
                    if (error) throw error;
                }
                else if (item.table_name === 'patients' && item.action === 'UPDATE') {
                    await _supabase.from('patients').update(item.payload).eq('id', item.payload.id).eq('tenant_id', TEBA_CONFIG.tenant.id);
                }
                else if (item.table_name === 'visits') {
                    if(item.action === 'UPDATE') {
                        const localVisit = await db.visits.get(Number(item.payload.visit_id));
                        const targetId = localVisit && localVisit.server_id ? localVisit.server_id : item.payload.visit_id;
                        const updateData = { ...item.payload };
                        delete updateData.visit_id;
                        delete updateData.published_at;
                        delete updateData.client_uuid; 
                        const { error } = await _supabase.from('visits').update(updateData).eq('visit_id', targetId).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        if (error) throw error;
                    } else if (item.action === 'DELETE') {
                        const localVisit = await db.visits.get(Number(item.payload.visit_id));
                        const targetId = localVisit && localVisit.server_id ? localVisit.server_id : item.payload.visit_id;
                        const { data: vt } = await _supabase.from('visit_tests').select('id').eq('visit_id', targetId).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        if(vt && vt.length > 0) { await _supabase.from('test_results').delete().in('visit_test_id', vt.map(x => x.id)); }
                        await _supabase.from('visit_tests').delete().eq('visit_id', targetId).eq('tenant_id', TEBA_CONFIG.tenant.id);
                        await _supabase.from('visits').delete().eq('visit_id', targetId).eq('tenant_id', TEBA_CONFIG.tenant.id);
                    }
                }
                else if (item.table_name === 'financial_ledger') {
                    // التعديل السحري: لو الحركة مش موجودة، هنضيفها. لو موجودة، هنحدثها.
                    if (item.action === 'UPDATE') {
                        const { data: existing } = await _supabase.from('financial_ledger').select('id').eq('visit_id', item.payload.visit_id).eq('tenant_id', TEBA_CONFIG.tenant.id).eq('type', 'revenue').single();
                        if (existing) {
                            await _supabase.from('financial_ledger').update({ amount: item.payload.amount, item_name: item.payload.item_name }).eq('id', existing.id);
                        } else {
                            const newPayload = { ...item.payload, type: 'revenue', created_at: new Date().toISOString() };
                            await _supabase.from('financial_ledger').insert([newPayload]);
                        }
                    } else {
                        const { data: existing } = await _supabase.from('financial_ledger').select('id').eq('visit_id', item.payload.visit_id).eq('tenant_id', TEBA_CONFIG.tenant.id).eq('type', 'revenue').single();
                        if (existing) {
                             await _supabase.from('financial_ledger').update({ amount: item.payload.amount, item_name: item.payload.item_name }).eq('id', existing.id);
                        } else {
                             await _supabase.from('financial_ledger').insert([item.payload]);
                        }
                    }
                }
                else if (item.table_name === 'audit_logs') {
                    const { error } = await _supabase.from('audit_logs').insert([item.payload]);
                    if (error) console.warn('Audit log failed', error);
                }

                await db.outbox.delete(item.id);
                successCount++;
            } catch (e) { 
                console.error("Outbox item sync failed:", item, e); 
                failCount++;
            }
        }

        if (successCount > 0 && failCount === 0) showToast(`✅ تمت مزامنة ${successCount} عملية بنجاح!`);
        else if (successCount > 0 && failCount > 0) showToast(`⚠️ نجح ${successCount} وفشل ${failCount}.`, true);
        else if (failCount > 0) showToast(`❌ فشل مزامنة ${failCount} عملية.`, true);
        
        const remaining = await db.outbox.count();
        if (remaining === 0) { if(btn) btn.style.display = 'none'; }
        else { if(btn) btn.innerText = '🔄 مزامنة البيانات'; }
        
        await loadData(); 
    } catch(e) {
        console.error("Outbox error:", e);
        const btn = document.getElementById('syncBtn');
        if(btn) btn.innerText = '🔄 مزامنة البيانات';
    } finally {
        isSyncing = false; 
    }
}

window.addEventListener('online', () => { processOutbox(); });
window.addEventListener('offline', () => { showToast('⚠️ انقطع الاتصال. تم تفعيل وضع الأوفلاين.', true); });

const bc = new BroadcastChannel('teba_sync');
bc.onmessage = (event) => {
    if (event.data && event.data.type === 'new_order') {
        if (String(event.data.branch_id) === String(currentLabBranch)) {
            const audio = document.getElementById('notifSound');
            if (audio) { audio.play().catch(e => console.warn("المتصفح منع تشغيل الصوت", e)); }
            showToast('🔔 وصل طلب جديد من الاستقبال!', false);
            loadData();
        }
    }
};

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg; 
    t.className = isError ? 'error' : '';
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 4000);
}// ==========================================
// 📥 جلب البيانات (من السحابة للمحلي)
// ==========================================
async function loadData() {
    try {
        if (navigator.onLine) {
            const { data: catalog, error: catErr } = await _supabase.from('tests_catalog').select('*').eq('tenant_id', TEBA_CONFIG.tenant.id);
            if (!catErr && catalog) {
                if (catalog.length === 0) { 
                    await db.catalog.clear(); 
                } else {
                    await db.catalog.clear();
                    await db.catalog.bulkPut(catalog.map(t => ({ id: t.id, code: t.code, name: t.name, price: t.price, category: t.category || 'أخرى', parameters: t.parameters, test_type: t.test_type, unit: t.unit })));
                }
            }

            const { data: visits, error: visErr } = await _supabase.from('visits')
                .select('*')
                .eq('tenant_id', TEBA_CONFIG.tenant.id)
                .eq('branch_id', currentLabBranch) 
                .order('visit_id', { ascending: false })
                .limit(100);
            
            if (!visErr && visits && visits.length > 0) {
                const serverVisitIds = visits.map(v => Number(v.visit_id));
                const localDbVisits = await db.visits.where('branch_id').equals(Number(currentLabBranch)).toArray();
                
                // تنظيف الزيارات المحذوفة من السحابة
                for (let lv of localDbVisits) {
                    if (lv.server_id && !serverVisitIds.includes(Number(lv.server_id))) {
                        await db.visits.delete(lv.visit_id);
                        const vts = await db.visit_tests.where('visit_id').equals(lv.visit_id).toArray();
                        for(let vt of vts) { await db.test_results.where('visit_test_id').equals(vt.id).delete(); }
                        await db.visit_tests.where('visit_id').equals(lv.visit_id).delete();
                    }
                }

                for (let v of visits) {
                    const localV = await db.visits.get(Number(v.visit_id));
                    if (localV && localV.hidden_in_lab === true) { v.hidden_in_lab = true; }
                    v.server_id = v.visit_id; 
                }

                const visitIds = visits.map(v => v.visit_id);
                const patientIds = [...new Set(visits.map(v => v.patient_id))];
                
                const { data: patients } = await _supabase.from('patients').select('*').in('id', patientIds).eq('tenant_id', TEBA_CONFIG.tenant.id);
                const { data: vt } = await _supabase.from('visit_tests').select('*').in('visit_id', visitIds).eq('tenant_id', TEBA_CONFIG.tenant.id);
                const vtIds = vt ? vt.map(v => v.id) : [];
                
                let results = [];
                if (vtIds.length > 0) {
                    const { data: res } = await _supabase.from('test_results').select('*').in('visit_test_id', vtIds).eq('tenant_id', TEBA_CONFIG.tenant.id);
                    results = res || [];
                }
                
                try { if (patients) await db.patients.bulkPut(patients); } catch(e) {}
                try { if (visits) await db.visits.bulkPut(visits); } catch(e) {}
                
                if (vt) {
                    const serverVtIds = vt.map(x => x.id);
                    const localVts = await db.visit_tests.where('visit_id').anyOf(visitIds).toArray();
                    for(let lvt of localVts) {
                        if(!serverVtIds.includes(lvt.id)) {
                            await db.visit_tests.delete(lvt.id);
                            await db.test_results.where('visit_test_id').equals(lvt.id).delete();
                        }
                    }
                    await db.visit_tests.bulkPut(vt);
                }
                
                try { if (results) await db.test_results.bulkPut(results); } catch(e) {}
            }
        }

        testsCatalog = await db.catalog.toArray();
        
        const allLocalVisits = await db.visits.toArray();
        let localVisits = allLocalVisits.filter(v => String(v.branch_id) === String(currentLabBranch) && (showHiddenVisits || v.hidden_in_lab !== true));
        
        localVisits.sort((a, b) => Number(b.visit_id) - Number(a.visit_id));
        localVisits = localVisits.slice(0, 100);

        allVisits = [];
        for (let v of localVisits) {
            const p = await db.patients.get(v.patient_id) || { name: 'غير معروف', age: 0, age_type: 'Years', gender: 'male', doctor_name: '-' };
            allVisits.push({ ...v, patient: p });
        }

        visitTests = await db.visit_tests.toArray();
        testResults = await db.test_results.toArray();

        renderPatients();
        populateSelectors(); 
        checkSyncStatus();

        const urlParams = new URLSearchParams(window.location.search);
        const urlVisitId = urlParams.get('visit_id');
        if (urlVisitId && allVisits.find(v => v.visit_id == urlVisitId)) { selectPatient(urlVisitId); }

    } catch(e) {
        console.error("Load Data Error:", e);
        renderPatients();
    }
}

async function checkSyncStatus() {
    const pending = await db.outbox.count();
    const syncBtn = document.getElementById('syncBtn');
    if(syncBtn) {
        if(pending > 0) syncBtn.style.display = 'flex';
        else syncBtn.style.display = 'none';
    }
}

setInterval(() => {
    if (navigator.onLine && !isSyncing) {
        processOutbox();
    }
}, 60000);

// ==========================================
// ⚙️ جلب إعدادات الطباعة
// ==========================================
async function loadPrintSettings() {
    try {
        // جلب من المحلي أولاً
        const localHeader = localStorage.getItem('teba_print_header');
        const localFooter = localStorage.getItem('teba_print_footer');
        if(localHeader) printSettings.header = localHeader;
        if(localFooter) printSettings.footer = localFooter;

        // جلب من السحابة لو متاح
        if(navigator.onLine) {
            const { data } = await _supabase.from('site_settings').select('print_header, print_footer').eq('tenant_id', TEBA_CONFIG.tenant.id).single();
            if(data) {
                if(data.print_header) { printSettings.header = data.print_header; localStorage.setItem('teba_print_header', data.print_header); }
                if(data.print_footer) { printSettings.footer = data.print_footer; localStorage.setItem('teba_print_footer', data.print_footer); }
            }
        }
    } catch(e) { console.log("Print settings error:", e); }
}

// ==========================================
// 🖥️ واجهة المستخدم وعرض المرضى
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const headerActions = document.querySelector('.header-actions');
    if (headerActions) {
        const btnShowHidden = document.createElement('button');
        btnShowHidden.className = 'nav-btn';
        btnShowHidden.style.background = 'var(--surface-hover)';
        btnShowHidden.id = 'btnToggleHidden';
        btnShowHidden.innerHTML = '👁️ عرض المحذوفات';
        btnShowHidden.onclick = () => { 
            showHiddenVisits = !showHiddenVisits; 
            btnShowHidden.innerHTML = showHiddenVisits ? '🙈 إخفاء المحذوفات' : '👁️ عرض المحذوفات';
            loadData(); 
        };
        headerActions.insertBefore(btnShowHidden, headerActions.firstChild);
    }
});

function renderPatients() {
    const list = document.getElementById('patientList');
    if (!list) return;
    if (allVisits.length === 0) return list.innerHTML = '<div class="empty-msg">لا توجد زيارات لهذا الفرع</div>';
    
    list.innerHTML = allVisits.map(v => {
        let ageStr = v.patient.age + ' سنة';
        if(v.patient.age_type === 'Months') ageStr = v.patient.age + ' شهر';
        if(v.patient.age_type === 'Days') ageStr = v.patient.age + ' يوم';
        const pubBadge = v.is_published ? `<span class="badge-published">تم النشر</span>` : '';
        const paddedId = String(v.visit_id).padStart(4, '0');
        
        let actionBtn = v.hidden_in_lab ? 
            `<button class="btn-card-action" style="background:#e0f2fe; color:#0284c7;" onclick="event.stopPropagation(); restoreToLabQueue('${v.visit_id}')">🔄 إرجاع</button>` :
            `<button class="btn-card-action btn-card-del" onclick="event.stopPropagation(); hideFromLabQueue('${v.visit_id}')">🗑️ إخفاء</button>`;

        return `
        <div class="patient-card ${String(v.visit_id) === String(selectedVisitId) ? 'active' : ''}" onclick="selectPatient('${v.visit_id}')">
            ${pubBadge}
            <div class="p-name">${v.patient.name}</div>
            <div class="p-meta"><span>زيارة #${paddedId}</span><span>${v.patient.gender === 'male' ? 'ذكر' : 'أنثى'} • ${ageStr}</span></div>
            <div class="card-actions">
                <button class="btn-card-action btn-card-edit" onclick="event.stopPropagation(); openEditPatientModal('${v.visit_id}')">✏️ تعديل</button>
                ${actionBtn}
            </div>
        </div>`;
    }).join('');
}

async function hideFromLabQueue(visitId) {
    if(!confirm('إخفاء هذه الحالة من طابور المعمل؟')) return;
    try {
        const v = await db.visits.get(Number(visitId));
        if (v) {
            v.hidden_in_lab = true;
            await db.visits.put(v);
            await addToOutbox('visits', 'UPDATE', { visit_id: parseInt(visitId), hidden_in_lab: true });
            allVisits = allVisits.filter(visit => String(visit.visit_id) !== String(visitId));
            renderPatients();
            if (String(selectedVisitId) === String(visitId)) { 
                selectedVisitId = null; 
                document.getElementById('singleTestsContainer').innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
                document.getElementById('profileTestsContainer').innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
                document.getElementById('btnPublishVisit').style.display = 'none';
                document.getElementById('btnDownloadPdf').style.display = 'none';
            }
            if (navigator.onLine) processOutbox();
        }
    } catch (e) { console.error(e); }
}

async function restoreToLabQueue(visitId) {
    try {
        const v = await db.visits.get(Number(visitId));
        if (v) {
            v.hidden_in_lab = false;
            await db.visits.put(v);
            await addToOutbox('visits', 'UPDATE', { visit_id: parseInt(visitId), hidden_in_lab: false });
            if (navigator.onLine) processOutbox();
            await loadData(); 
        }
    } catch (e) { console.error(e); }
}

async function publishVisit() {
    if (!selectedVisitId) return;
    try {
        const visit = await db.visits.get(Number(selectedVisitId));
        if (visit) {
            visit.is_published = true;
            await db.visits.put(visit);
            await addToOutbox('visits', 'UPDATE', { visit_id: parseInt(selectedVisitId), is_published: true });
            
            await addToOutbox('audit_logs', 'INSERT', {
                tenant_id: TEBA_CONFIG.tenant.id,
                action_type: 'نشر نتيجة',
                details: `تم نشر نتيجة الزيارة #${selectedVisitId}`,
                created_at: new Date().toISOString()
            });

            if (navigator.onLine) processOutbox();
            selectPatient(selectedVisitId); 
            showToast('✅ تم النشر بنجاح!');
        }
    } catch(e) { showToast('❌ حدث خطأ أثناء النشر', true); }
}

function sendLabWhatsApp() {
    if (!selectedVisitId) return showToast('⚠️ اختر مريضاً أولاً', true);
    const visit = allVisits.find(v => String(v.visit_id) === String(selectedVisitId));
    if (!visit || !visit.patient) return;
    let cleanPhone = (visit.patient.phone || '').replace(/\D/g, ''); 
    if (!cleanPhone) return window.open(`https://wa.me/?text=مرحباً`, '_blank');
    if (cleanPhone.startsWith('0')) cleanPhone = '20' + cleanPhone.substring(1);
    else if (cleanPhone.startsWith('1')) cleanPhone = '20' + cleanPhone;
    else if (cleanPhone.startsWith('0020')) cleanPhone = cleanPhone.substring(2);
    const msg = `أهلاً ${visit.patient.name} 👋،\nنتيجة تحليلك جاهزة 🧪.\nرقم الزيارة (${String(visit.visit_id).padStart(4, '0')}):\n${TEBA_CONFIG.lab.portalUrl}`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ==========================================
// 📝 المودالات وتسجيل النتائج
// ==========================================
function openSingleResultModal(vtId, testCode){
    const catalogItem = testsCatalog.find(c => c.code === testCode) || { name: testCode, parameters: [] };
    const result = testResults.find(r => String(r.visit_test_id) === String(vtId));
    const savedData = result ? result.results_data : {};
    const p = getSmartParams(catalogItem)[0] || { name: 'Result' };
    const val = savedData[p.name]?.value || savedData['Result']?.value || '';
    const savedCustomRange = savedData[p.name]?.customRange || savedData['Result']?.customRange || window.customRanges[`${vtId}_result`] || '';
    const visit = allVisits.find(v => String(v.visit_id) === String(selectedVisitId));
    const range = savedCustomRange || getSmartRange(p, visit ? visit.patient : {age:0, age_type:'Years', gender:'male'}, null, savedData);

    document.getElementById('singleModalTitle').innerText = `🧪 تسجيل نتيجة: ${catalogItem.name}`;
    document.getElementById('singleResultArea').innerHTML = `
        <div class="test-item"><div class="test-body"><div class="input-group">
            <label><span>النتيجة</span>
                <span class="range-info" id="range_container_${vtId}_result">
                    <span id="range_text_${vtId}_result">${range}</span> ${p.unit || catalogItem.unit || ''}
                    <button type="button" class="btn-edit-range" onclick="enableRangeEdit('${vtId}', 'result', true)" style="background:none; border:none; cursor:pointer;">✏️</button>
                </span>
            </label>
            <input type="text" id="res_${vtId}_simple" value="${val}" style="font-size: 1.5rem; padding: 15px;" onkeydown="handleEnter(event, this, '${vtId}', false)">
        </div></div></div>`;

    document.getElementById('btnSaveSingleResult').onclick = () => saveSingleResult(vtId);
    document.getElementById('singleResultModal').style.display = 'flex';
    setTimeout(() => { const i = document.getElementById(`res_${vtId}_simple`); if(i) i.focus(); }, 100);
}

window.enableRangeEdit = function(vtId, paramName, isSingle = false) {
    const container = document.getElementById(`range_container_${vtId}_${paramName}`);
    if(!container) return;
    const currentRange = document.getElementById(`range_text_${vtId}_${paramName}`).innerText;
    container.innerHTML = `<input type="text" id="custom_range_${vtId}_${paramName}" value="${currentRange}" style="width:100px; padding:2px; border:1px solid var(--primary); border-radius:4px;">`;
    const input = document.getElementById(`custom_range_${vtId}_${paramName}`);
    input.focus(); input.select();
    input.onblur = function() {
        if (this.value.trim() === '') return; 
        window.customRanges[`${vtId}_${paramName}`] = this.value.trim();
        container.innerHTML = `<span id="range_text_${vtId}_${paramName}">${this.value}</span> <button type="button" class="btn-edit-range" onclick="enableRangeEdit('${vtId}', '${paramName}', ${isSingle})" style="background:none; border:none; cursor:pointer;">✏️</button>`;
    };
    input.onkeydown = function(e) { if(e.key === 'Enter') this.blur(); };
}

function openProfileResultModal(vtId, testCode) {
    const catalogItem = testsCatalog.find(c => c.code === testCode) || { name: testCode, parameters: [] };
    const params = getSmartParams(catalogItem);
    const result = testResults.find(r => String(r.visit_test_id) === String(vtId));
    const savedData = result ? result.results_data : {};
    const visit = allVisits.find(v => String(v.visit_id) === String(selectedVisitId));
    const patient = visit ? visit.patient : { age: 0, age_type: 'Years', gender: 'male' };

    document.getElementById('profileModalTitle').innerText = `🧬 تسجيل نتائج: ${catalogItem.name}`;
    const area = document.getElementById('profileResultsArea');
    
    let inputsHtml = '';
    params.forEach(param => {
        const val = savedData[param.name]?.value || '';
        const customR = window.customRanges[`${vtId}_${param.name}`] || savedData[param.name]?.customRange || '';
        const range = customR || getSmartRange(param, patient, savedData[param.name]?.phase || null, savedData);
        const isCalc = param.is_calc === true || param.is_calculated === true;
        const phaseSelectorHtml = renderPhaseSelector(vtId, param, patient, savedData);
        
        let inputElement = `<input type="text" class="${isCalc ? 'input-calc' : ''}" id="res_${vtId}_${param.name}" value="${val}" ${isCalc ? 'readonly' : ''} oninput="triggerCalc('${vtId}', '${testCode}')" onkeydown="handleEnter(event, this, '${vtId}', true); handleArrowKeys(event, this)">`;
        if (param.type === 'dropdown' && param.options) {
            let opts = `<option value="">-- اختر --</option>` + param.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('');
            inputElement = `<select id="res_${vtId}_${param.name}" onchange="triggerCalc('${vtId}', '${testCode}')" onkeydown="handleArrowKeys(event, this)">${opts}</select>`;
        }
        inputsHtml += `
            <div class="input-group">${phaseSelectorHtml}
                <label><span>${param.label || param.name}</span>
                    <span class="range-info" id="range_container_${vtId}_${param.name}">
                        <span id="range_text_${vtId}_${param.name}">${range}</span> ${param.unit || ''}
                        <button type="button" class="btn-edit-range" onclick="enableRangeEdit('${vtId}', '${param.name}', false)" style="background:none; border:none; cursor:pointer;">✏️</button>
                    </span>
                </label>${inputElement}
            </div>`;
    });
    area.innerHTML = `<div class="test-item"><div class="test-body">${inputsHtml}</div></div>`;
    document.getElementById('btnSaveProfileResult').onclick = () => saveProfileResult(vtId, testCode);
    document.getElementById('profileResultModal').style.display = 'flex';
    setTimeout(() => { const i = area.querySelector('input:not([readonly]), select'); if(i) i.focus(); }, 100);
}

function openResultModal(vtId, isProfile, testCode) {
    if (isProfile) openProfileResultModal(vtId, testCode);
    else openSingleResultModal(vtId, testCode);
}

function handleEnter(e, el, vtId, isProfile) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!isProfile) document.getElementById('btnSaveSingleResult').click();
        else {
            let inputs = Array.from(el.closest('.modal-body').querySelectorAll('input:not([readonly]), select'));
            let index = inputs.indexOf(el);
            if (index > -1 && index < inputs.length - 1) inputs[index + 1].focus();
            else { const saveBtn = document.getElementById('btnSaveProfileResult'); if(saveBtn) saveBtn.focus(); }
        }
    }
}

function handleArrowKeys(e, el) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let inputs = Array.from(el.closest('.modal-body').querySelectorAll('input:not([readonly]), select'));
        let index = inputs.indexOf(el);
        if (e.key === 'ArrowDown' && index < inputs.length - 1) inputs[index + 1].focus();
        else if (e.key === 'ArrowUp' && index > 0) inputs[index - 1].focus();
    }
}

async function saveSingleResult(vtId) {
    const input = document.getElementById(`res_${vtId}_simple`);
    if (!input || input.value.trim() === '') return showToast('⚠️ أدخل النتيجة أولاً', true);
    const vt = visitTests.find(v => String(v.id) === String(vtId));
    const p = getSmartParams(testsCatalog.find(c => c.code === vt.test_code))[0] || { name: 'Result' };
    
    let resultsData = { [p.name]: { value: input.value.trim() } };
    let customRange = window.customRanges[`${vtId}_result`] || window.customRanges[`${vtId}_Result`] || window.customRanges[`${vtId}_${p.name}`];
    
    if (!customRange) {
        const rangeTextEl = document.getElementById(`range_text_${vtId}_result`);
        if (rangeTextEl && rangeTextEl.innerText.trim() !== '-') {
            customRange = rangeTextEl.innerText.trim();
        }
    }
    if (customRange) resultsData[p.name].customRange = customRange;
    
    await saveResultToCloud(vtId, resultsData);
    document.getElementById('singleResultModal').style.display = 'none';
    renderOrderedTests();
}

async function saveProfileResult(vtId, testCode) {
    const params = getSmartParams(testsCatalog.find(c => c.code === testCode));
    triggerCalc(vtId, testCode);
    let resultsData = {};
    params.forEach(param => {
        const input = document.getElementById(`res_${vtId}_${param.name}`);
        const phaseSelect = document.getElementById(`phase_${vtId}_${param.name}`);
        
        if (input && input.value.trim() !== '') {
            resultsData[param.name] = { value: input.value.trim() };
            if (phaseSelect) resultsData[param.name].phase = phaseSelect.value;
            
            let customRange = window.customRanges[`${vtId}_${param.name}`];
            if (!customRange) {
                const rangeTextEl = document.getElementById(`range_text_${vtId}_${param.name}`);
                if (rangeTextEl && rangeTextEl.innerText.trim() !== '-') {
                    customRange = rangeTextEl.innerText.trim();
                }
            }
            if (customRange) resultsData[param.name].customRange = customRange;
        }
    });
    if (Object.keys(resultsData).length === 0) return showToast('⚠️ لم يتم إدخال أي نتائج', true);
    await saveResultToCloud(vtId, resultsData);
    document.getElementById('profileResultModal').style.display = 'none';
    renderOrderedTests();
}

async function saveResultToCloud(visitTestId, resultsData) {
    try {
        const vt = visitTests.find(v => String(v.id) === String(visitTestId));
        let existing = await db.test_results.where('visit_test_id').equals(vt.id).first();
        if(existing) await db.test_results.update(existing.id, { results_data: resultsData });
        else await db.test_results.put({ id: String(Date.now()), visit_test_id: vt.id, results_data: resultsData });
        
        await addToOutbox('test_results', 'UPSERT', { tenant_id: TEBA_CONFIG.tenant.id, visit_test_id: vt.id, results_data: resultsData });
        
        const idx = testResults.findIndex(r => String(r.visit_test_id) === String(visitTestId));
        if (idx > -1) testResults[idx].results_data = resultsData;
        else testResults.push({ visit_test_id: visitTestId, results_data: resultsData });
        
        showToast('✅ تم الحفظ محلياً!');
        if (navigator.onLine) processOutbox();
    } catch (e) { showToast('❌ حدث خطأ أثناء الحفظ', true); console.error(e); }
}// ==========================================
// 🧮 الرينجات الديناميكية والحسابات
// ==========================================
function getSmartRange(param, patient, selectedPhase = null, savedData = {}) {
    if (savedData && savedData[param.name] && savedData[param.name].customRange) return savedData[param.name].customRange;
    if (param.ranges && Array.isArray(param.ranges) && param.ranges.length > 0) {
        const pAge = parseFloat(patient.age) || 0;
        const pUnit = patient.age_type || 'Years';
        const pSex = patient.gender === 'male' ? 'Male' : 'Female';
        
        let pAgeInDays = pAge;
        if (pUnit === 'Years') pAgeInDays = pAge * 365;
        if (pUnit === 'Months') pAgeInDays = pAge * 30;
        
        for (let r of param.ranges) {
            if (r.sex !== 'All' && r.sex !== pSex) continue;
            
            let rFromDays = r.age_from || 0;
            if (r.age_unit === 'Years') rFromDays *= 365;
            if (r.age_unit === 'Months') rFromDays *= 30;
            
            let rToDays = r.age_to || 120;
            if (r.age_unit === 'Years') rToDays *= 365;
            if (r.age_unit === 'Months') rToDays *= 30;
            
            if (pAgeInDays >= rFromDays && pAgeInDays <= rToDays) {
                if (r.normal_text && r.normal_text !== '-' && r.normal_text !== '') return r.normal_text;
                if (r.min !== null && r.max !== null) return `${r.min} - ${r.max}`;
            }
        }
    }
    let rawRange = patient.gender === 'female' ? param.ref_female : param.ref_male;
    if (typeof rawRange === 'object' && rawRange !== null) rawRange = rawRange.range;
    if (!rawRange || rawRange === '-' || rawRange === 'N/A') rawRange = param.ref_child || param.reference_range || '-';
    if (selectedPhase && typeof rawRange === 'string' && rawRange.includes(selectedPhase)) {
        let parts = rawRange.split('|').map(p => p.trim());
        let match = parts.find(p => p.toLowerCase().startsWith(selectedPhase.toLowerCase()));
        if (match) return match.substring(match.indexOf(':') + 1).trim();
    }
    return rawRange;
}

function renderPhaseSelector(vtId, param, patient, savedData) {
    if (patient.gender !== 'female') return '';
    let rawRange = param.ref_female || '';
    if (typeof rawRange === 'object' && rawRange !== null) rawRange = rawRange.range || '';
    if (typeof rawRange !== 'string') rawRange = '';
    const phases = ['Follicular', 'Midcycle', 'Ovulatory', 'Luteal', 'Pregnant', 'Postmenopausal', 'Prostate'];
    let availablePhases = phases.filter(p => rawRange.toLowerCase().includes(p.toLowerCase()));
    if (availablePhases.length > 0) {
        const savedPhase = savedData[param.name]?.phase || availablePhases[0];
        let opts = availablePhases.map(p => `<option value="${p}" ${savedPhase === p ? 'selected' : ''}>${p}</option>`).join('');
        return `<select class="phase-selector" id="phase_${vtId}_${param.name}" onchange="updateRangeUI('${vtId}', '${param.name}', '${param.ref_male}', '${rawRange}', ${patient.age}, '${patient.age_type}', '${patient.gender}')">${opts}</select>`;
    }
    return '';
}

window.updateRangeUI = function(vtId, paramName, refMale, refFemale, age, ageType, gender) {
    const phaseSelect = document.getElementById(`phase_${vtId}_${paramName}`);
    const newRange = getSmartRange({ name: paramName, ref_male: refMale, ref_female: refFemale }, { age: age, age_type: ageType, gender: gender }, phaseSelect ? phaseSelect.value : null);
    const rangeLabel = document.getElementById(`range_text_${vtId}_${paramName}`);
    if (rangeLabel) rangeLabel.innerText = newRange;
};

function triggerCalc(visitTestId, testCode) {
    const catalogItem = testsCatalog.find(c => c.code === testCode);
    if (!catalogItem) return;
    const params = getSmartParams(catalogItem);
    let vals = {};
    params.forEach(p => {
        const input = document.getElementById(`res_${visitTestId}_${p.name}`);
        if (input && input.value.trim() !== '') {
            let parsed = parseFloat(input.value);
            if (!isNaN(parsed)) vals[p.name] = parsed;
        }
    });
    let hba1c = vals['HbA1c'] || vals['HbA1C'] || vals['HBA1C'];
    if (hba1c !== undefined) {
        let eagInput = document.getElementById(`res_${visitTestId}_eAG`);
        if (eagInput) { let eagVal = (28.7 * hba1c) - 46.7; eagInput.value = eagVal.toFixed(1); vals['eAG'] = eagVal; }
    }
    params.forEach(p => {
        if (p.name.toLowerCase() === 'eag') return;
        let calcVal = null; let formula = p.formula;
        if (formula) {
            try {
                let evalStr = formula; let hasAllVars = true;
                let vars = formula.match(/[a-zA-Z_]+/g) || [];
                vars = vars.filter(v => v !== 'Math' && v !== 'min' && v !== 'max');
                for (let v of vars) {
                    let valToUse = undefined;
                    for (let key in vals) { if (key.toLowerCase() === v.toLowerCase()) { valToUse = vals[key]; break; } }
                    if (valToUse === undefined) { hasAllVars = false; break; }
                    evalStr = evalStr.replace(new RegExp('\\b' + v + '\\b', 'g'), valToUse);
                }
                if (hasAllVars) calcVal = Function('"use strict";return (' + evalStr + ')')();
            } catch(e) {}
        }
        if (calcVal !== null && isFinite(calcVal) && calcVal >= 0) {
            const input = document.getElementById(`res_${visitTestId}_${p.name}`);
            if (input) input.value = parseFloat(calcVal.toFixed(1));
        }
    });
}

// ==========================================
// ✏️ التعديل والإضافة
// ==========================================
function openEditPatientModal(visitId) {
    const v = allVisits.find(x => String(x.visit_id) === String(visitId));
    if(!v || !v.patient) return;
    
    if (userRole !== 'admin' && userRole !== 'owner') {
        document.getElementById('editPBranch').parentElement.style.display = 'none';
    } else {
        document.getElementById('editPBranch').parentElement.style.display = 'flex';
    }

    document.getElementById('editVisitId').value = v.visit_id;
    document.getElementById('editVisitIdDisplay').value = String(v.visit_id).padStart(4, '0');
    document.getElementById('editPatientId').value = v.patient.id;
    document.getElementById('editPName').value = v.patient.name;
    document.getElementById('editPPhone').value = v.patient.phone || '';
    document.getElementById('editPDoctor').value = v.patient.doctor_name || '';
    document.getElementById('editPAge').value = v.patient.age || 30;
    document.getElementById('editPAgeType').value = v.patient.age_type || 'Years';
    document.getElementById('editPGender').value = v.patient.gender || 'male';
    document.getElementById('editPBranch').value = v.branch_id || 1;
    document.getElementById('editPatientModal').style.display = 'flex';
}

async function savePatientEdit() {
    const pId = document.getElementById('editPatientId').value;
    const vId = document.getElementById('editVisitId').value;
    const name = document.getElementById('editPName').value.trim();
    if(!name) return showToast('⚠️ اسم المريض مطلوب', true);
    
    const btn = document.querySelector('#editPatientModal .btn-save-test');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const pPayload = { id: pId, tenant_id: TEBA_CONFIG.tenant.id, name, phone: document.getElementById('editPPhone').value.trim(), doctor_name: document.getElementById('editPDoctor').value.trim(), age: parseInt(document.getElementById('editPAge').value) || 0, age_type: document.getElementById('editPAgeType').value, gender: document.getElementById('editPGender').value };
        await db.patients.update(pId, pPayload);
        await addToOutbox('patients', 'UPDATE', pPayload);
        
        let vPayload = { visit_id: parseInt(vId) };
        if (userRole === 'admin' || userRole === 'owner') {
            vPayload.branch_id = parseInt(document.getElementById('editPBranch').value);
            await db.visits.update(parseInt(vId), { branch_id: vPayload.branch_id });
        }
        await addToOutbox('visits', 'UPDATE', vPayload);
        
        document.getElementById('editPatientModal').style.display = 'none';
        if (navigator.onLine) processOutbox();
        await loadData(); 
        if (String(selectedVisitId) === String(vId)) selectPatient(vId);
    } catch(e) { showToast('❌ حدث خطأ', true); } finally { btn.innerText = '💾 حفظ التعديلات'; btn.disabled = false; }
}

function populateSelectors() {
    const singles = testsCatalog.filter(t => !isProfileTest(t)).sort((a,b) => a.name.localeCompare(b.name));
    const profiles = testsCatalog.filter(t => isProfileTest(t)).sort((a,b) => a.name.localeCompare(b.name));
    document.getElementById('singleTestSelect').innerHTML = `<option value="">-- اختر تحليلاً --</option>` + singles.map(t => `<option value="${t.code}">${t.name} (${t.code})</option>`).join('');
    document.getElementById('profileTestSelect').innerHTML = `<option value="">-- اختر بروفايل --</option>` + profiles.map(t => `<option value="${t.code}">${t.name} (${t.code})</option>`).join('');
    document.getElementById('singleTestSelect').onchange = () => { if(document.getElementById('singleTestSelect').value) addTestFromSelect('single'); };
    document.getElementById('profileTestSelect').onchange = () => { if(document.getElementById('profileTestSelect').value) addTestFromSelect('profile'); };
}

function isProfileTest(catalogItem) {
    if (!catalogItem) return false;
    if (catalogItem.test_type === 'Profile') return true;
    let params = catalogItem.parameters;
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch(e) { params = []; } }
    if (!Array.isArray(params)) params = [];
    return params.length > 1 || (params.length === 1 && params[0].name !== 'Result');
}

function getSmartParams(catalogItem) {
    let params = catalogItem.parameters;
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch(e) { params = []; } }
    if (!Array.isArray(params)) params = [];
    else params = JSON.parse(JSON.stringify(params)); 
    const isLipid = (catalogItem.name && catalogItem.name.toUpperCase().includes('LIPID')) || catalogItem.code === '109';
    if (isLipid) {
        params = params.filter(p => !p.name.toLowerCase().includes('ldl'));
        params.push({ name: 'LDL', label: 'LDL (Calc)', unit: 'mg/dL', ref_male: '< 130', ref_female: '< 130', is_calc: true, formula: "CHO - HDL - (TRIG / 5)" });
    }
    return params;
}

function renderOrderedTests() {
    const singleContainer = document.getElementById('singleTestsContainer');
    const profileContainer = document.getElementById('profileTestsContainer');
    if (!selectedVisitId) {
        singleContainer.innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
        profileContainer.innerHTML = '<div class="empty-msg">اختر مريضاً</div>';
        return;
    }
    
    let vTestsRaw = visitTests.filter(vt => String(vt.visit_id) === String(selectedVisitId) && vt.is_cancelled !== true);
    
    const seenCodes = new Set();
    const vTests = [];
    for (const vt of vTestsRaw) {
        if (seenCodes.has(vt.test_code)) continue;
        seenCodes.add(vt.test_code);
        vTests.push(vt);
    }
    if (vTests.length === 0) {
        singleContainer.innerHTML = '<div class="empty-msg">لا توجد تحاليل مطلوبة</div>';
        profileContainer.innerHTML = '<div class="empty-msg">لا توجد تحاليل مطلوبة</div>';
        return;
    }
    let singlesHtml = '', profilesHtml = '';
    vTests.forEach(vt => {
        const catalogItem = testsCatalog.find(c => c.code === vt.test_code) || { name: vt.test_code, code: vt.test_code, parameters: [] };
        const isProfile = isProfileTest(catalogItem);
        const result = testResults.find(r => String(r.visit_test_id) === String(vt.id));
        const hasResult = result && result.results_data && Object.keys(result.results_data).length > 0;
        const rowHtml = `
            <div class="ordered-test-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div><span class="ordered-test-name">${catalogItem.name}</span> <span class="ordered-test-code">(${catalogItem.code})</span></div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="${hasResult ? 'btn-result done' : 'btn-result'}" onclick="openResultModal('${vt.id}', ${isProfile}, '${vt.test_code}')">${hasResult ? '👁️ عرض/تعديل' : '▶ Result'}</button>
                    <button onclick="removeTestFromOrder('${vt.id}', '${catalogItem.name}')" style="background:rgba(239,68,68,0.1); color:var(--danger); border:none; border-radius:8px; padding:8px 12px; cursor:pointer;">🗑️</button>
                </div>
            </div>`;
        if (isProfile) profilesHtml += rowHtml; else singlesHtml += rowHtml;
    });
    singleContainer.innerHTML = singlesHtml || '<div class="empty-msg">لا توجد تحاليل فردية مطلوبة</div>';
    profileContainer.innerHTML = profilesHtml || '<div class="empty-msg">لا توجد بروفايلات مطلوبة</div>';
}

async function removeTestFromOrder(vtId, testName) {
    if (!confirm('إلغاء هذا التحليل من الطلب؟')) return;
    try {
        await db.visit_tests.update(vtId, { is_cancelled: true });
        await addToOutbox('visit_tests', 'UPDATE', { id: vtId, is_cancelled: true });
        
        await addToOutbox('audit_logs', 'INSERT', {
            tenant_id: TEBA_CONFIG.tenant.id,
            action_type: 'إلغاء تحليل',
            details: `تم إلغاء تحليل (${testName}) من زيارة #${selectedVisitId}`,
            created_at: new Date().toISOString()
        });

        visitTests = visitTests.map(v => String(v.id) === String(vtId) ? { ...v, is_cancelled: true } : v);
        renderOrderedTests(); 
        if (navigator.onLine) processOutbox();
    } catch (e) { showToast('❌ حدث خطأ', true); }
}

async function addTestFromSelect(type) {
    if (!selectedVisitId) return showToast('⚠️ اختر مريضاً أولاً', true);
    const selectEl = document.getElementById(type === 'single' ? 'singleTestSelect' : 'profileTestSelect');
    const testCode = selectEl.value;
    if (!testCode) return;
    
    const existingTest = visitTests.find(v => String(v.visit_id) === String(selectedVisitId) && v.test_code === testCode);
    if (existingTest) {
        if (existingTest.is_cancelled === true) {
            await db.visit_tests.update(existingTest.id, { is_cancelled: false });
            await addToOutbox('visit_tests', 'UPDATE', { id: existingTest.id, is_cancelled: false });
            existingTest.is_cancelled = false;
            selectEl.value = '';
            renderOrderedTests();
            if (navigator.onLine) processOutbox();
        } else {
            showToast('⚠️ التحليل موجود بالفعل', true);
            selectEl.value = '';
        }
        return;
    }
    
    try {
        const payload = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), tenant_id: TEBA_CONFIG.tenant.id, visit_id: selectedVisitId, test_code: testCode, price_at_time: 0, is_cancelled: false };
        await db.visit_tests.put(payload);
        await addToOutbox('visit_tests', 'INSERT', payload);
        visitTests.push(payload);
        selectEl.value = '';
        renderOrderedTests(); 
        if (navigator.onLine) processOutbox();
    } catch (err) { showToast('❌ خطأ', true); }
}

function selectPatient(visitId) {
    selectedVisitId = visitId;
    renderPatients(); renderOrderedTests(); 
    document.getElementById('btnDownloadPdf').style.display = 'block';
    const visitObj = allVisits.find(v => String(v.visit_id) === String(visitId));
    const btnPub = document.getElementById('btnPublishVisit');
    if(btnPub && visitObj) { btnPub.style.display = 'block'; btnPub.innerHTML = visitObj.is_published ? '🔄 تحديث النشر' : '🌐 نشر الزيارة'; }
}

// ==========================================
// 🖨️ الطباعة و PDF (تم تعديلها لتقرأ من الإعدادات)
// ==========================================
function getHeaderHtml(visit, reqDate, printDate) {
    let ageStr = visit.patient.age + ' Years';
    if(visit.patient.age_type === 'Months') ageStr = visit.patient.age + ' Months';
    if(visit.patient.age_type === 'Days') ageStr = visit.patient.age + ' Days';
    return `
        <div class="print-header">
            <div class="print-header-left">
                <h1>${TEBA_CONFIG.lab.nameEn || 'TEBA LABS'}</h1>
                <p style="font-size: 15px;">For Medical Analyzes</p>
                <!-- هنا بنستخدم الهيدر اللي إنت كتبته في الإعدادات -->
                <p style="font-size: 14px; font-weight: bold;">${printSettings.header}</p>
                <p>${TEBA_CONFIG.lab.doctor || ''}</p>
            </div>
            <div class="print-header-right">
                <img src="../header.png" alt="Logo" onerror="this.style.display='none'">
            </div>
        </div>
        <div style="display: flex; justify-content: space-between; border: 1.5px solid #000; padding: 10px 15px; border-radius: 4px; background: #fff; font-size: 13px; margin-bottom: 20px;">
            <div style="width: 50%; display: flex; flex-direction: column; gap: 5px;">
                <div><strong>Patient:</strong> <span style="font-weight: bold;">${visit.patient.name || 'Unknown'}</span></div>
                <div><strong>Age/Gender:</strong> <span style="font-weight: bold;">${ageStr} / ${visit.patient.gender}</span></div>
                <div><strong>Referred By:</strong> <span style="font-weight: bold;">${visit.patient.doctor_name || '---'}</span></div>
            </div>
            <div style="width: 50%; display: flex; flex-direction: column; gap: 5px; text-align: right; border-left: 1.5px solid #000; padding-left: 15px;">
                <div><strong>Visit ID:</strong> <span style="font-weight: bold;">${String(visit.visit_id).padStart(4, '0')}</span></div>
                <div><strong>Request Date:</strong> <span style="font-weight: bold;">${reqDate}</span></div>
                <div><strong>Print Date:</strong> <span style="font-weight: bold;">${printDate}</span></div>
            </div>
        </div>`;
}

function getFooterHtml() {
    // هنا بنستخدم الفوتر اللي إنت كتبته في الإعدادات، وبيتحول لأسطر لو فيه Enter
    const footerText = printSettings.footer.replace(/\n/g, '<br>');
    return `<div class="print-footer" style="justify-content: center; text-align: center; border-top: 2px solid #000; padding-top: 10px; margin-top: 30px; font-size: 13px; font-weight: bold; color: #000;">
        <p>${footerText}</p>
    </div>`;
}

function openPrintModal() {
    if (!selectedVisitId) return alert('اختر مريضاً أولاً!');
    const visit = allVisits.find(v => String(v.visit_id) === String(selectedVisitId));
    if(!visit) return;
    
    const vTests = visitTests.filter(vt => String(vt.visit_id) === String(selectedVisitId) && vt.is_cancelled !== true);
    
    const reqDate = visit.visit_date ? new Date(visit.visit_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB');
    const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = '';
    let singlesRows = ''; let profilesData = []; 
    
    function getStateHtml(val, range) {
        if (!val || !range) return '';
        const num = parseFloat(val); const match = range.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
        let color = '#000'; let text = '';
        if (!isNaN(num) && match) {
            const min = parseFloat(match[1]), max = parseFloat(match[2]);
            if (num < min) { text = 'Low'; color = '#d32f2f'; }
            else if (num > max) { text = 'High'; color = '#d32f2f'; }
            else { text = 'Normal'; color = '#2e7d32'; }
        }
        if (text) return `<span style="border: 1px solid #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: ${color}; display: inline-block;">${text}</span>`;
        return '';
    }
    
    vTests.forEach(vt => {
        const catalogItem = testsCatalog.find(c => c.code === vt.test_code) || { name: vt.test_code, code: vt.test_code, parameters: [] };
        const result = testResults.find(r => String(r.visit_test_id) === String(vt.id));
        const savedData = result ? result.results_data : {};
        const params = getSmartParams(catalogItem);
        const isProfile = isProfileTest(catalogItem);
        let hasTestData = false; let testRows = '';
        
        if (isProfile) {
            params.forEach(param => {
                const val = savedData[param.name]?.value; const phase = savedData[param.name]?.phase; 
                if (val) {
                    hasTestData = true;
                    const range = getSmartRange(param, visit.patient, phase, savedData);
                    const flagStr = getStateHtml(val, range);
                    let displayParamName = param.label || param.name;
                    if (phase) displayParamName += ` (${phase})`;
                    testRows += `<tr><td style="border-bottom: 1px solid #ccc; padding: 8px 6px;">${displayParamName}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center; font-weight:bold;">${val}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${flagStr}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${param.unit||''}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${range}</td></tr>`;
                }
            });
            if (hasTestData) profilesData.push({ name: catalogItem.name, rows: testRows }); 
            else profilesData.push({ name: catalogItem.name, rows: `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">لا توجد نتائج محفوظة.</td></tr>` });
        } else {
            const p = params[0] || { name: 'Result' };
            const val = savedData[p.name]?.value || savedData['Result']?.value;
            if (val) {
                const range = getSmartRange(p, visit.patient, null, savedData);
                const flagStr = getStateHtml(val, range);
                singlesRows += `<tr><td style="border-bottom: 1px solid #ccc; padding: 8px 6px;">${catalogItem.name}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center; font-weight:bold;">${val}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${flagStr}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${p.unit||''}</td><td style="border-bottom: 1px solid #ccc; padding: 8px 6px; text-align:center;">${range}</td></tr>`;
            }
        }
    });
    
    let htmlContent = '';
    if (singlesRows !== '') htmlContent += `<div class="print-page">${getHeaderHtml(visit, reqDate, printDate)}<div style="margin-bottom: 25px;"><h3 style="margin: 0 0 10px 0; background: #eee; padding: 8px 12px; border-left: 4px solid #000;">SINGLE TESTS</h3><table style="width: 100%; border-collapse: collapse; font-size: 13px;"><thead><tr style="background: #000; color: #fff;"><th style="padding: 8px 6px; text-align:left;">Test Name</th><th style="padding: 8px 6px; text-align:center;">Result</th><th style="padding: 8px 6px; text-align:center;">State</th><th style="padding: 8px 6px; text-align:center;">Unit</th><th style="padding: 8px 6px; text-align:center;">Ref. Range</th></tr></thead><tbody>${singlesRows}</tbody></table></div>${getFooterHtml()}</div>`;
    profilesData.forEach(profile => { htmlContent += `<div class="print-page">${getHeaderHtml(visit, reqDate, printDate)}<div style="margin-bottom: 25px;"><h3 style="margin: 0 0 10px 0; background: #eee; padding: 8px 12px; border-left: 4px solid #000;">${profile.name}</h3><table style="width: 100%; border-collapse: collapse; font-size: 13px;"><thead><tr style="background: #000; color: #fff;"><th style="padding: 8px 6px; text-align:left;">Test Name</th><th style="padding: 8px 6px; text-align:center;">Result</th><th style="padding: 8px 6px; text-align:center;">State</th><th style="padding: 8px 6px; text-align:center;">Unit</th><th style="padding: 8px 6px; text-align:center;">Ref. Range</th></tr></thead><tbody>${profile.rows}</tbody></table></div>${getFooterHtml()}</div>`; });
    
    if (htmlContent === '') htmlContent += `<div class="print-page">${getHeaderHtml(visit, reqDate, printDate)}<p style="text-align:center; font-weight:bold; margin-top:50px;">No results recorded.</p>${getFooterHtml()}</div>`;
    
    printArea.innerHTML = htmlContent;
    document.getElementById('printModal').style.display = 'flex';
}

function downloadPDF() {
    if (!selectedVisitId) return alert('اختر مريضاً أولاً!');
    openPrintModal(); 
    const element = document.getElementById('print-area');
    const opt = { margin: 0, filename: `Report_Visit_${selectedVisitId}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, scrollY: 0 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    const btn = document.getElementById('btnDownloadPdf'); const originalText = btn.innerHTML; btn.innerHTML = '⏳ جاري التحميل...';
    html2pdf().set(opt).from(element).save().then(() => { btn.innerHTML = originalText; }).catch(err => { alert('حدث خطأ أثناء التحميل'); btn.innerHTML = originalText; });
}

// ==========================================
// 🚀 التشغيل عند فتح الصفحة
// ==========================================
window.onload = async () => { 
    // إخفاء اختيار الفرع لو المستخدم موظف
    if (userRole !== 'admin' && userRole !== 'owner') {
        const branchSelect = document.getElementById('labBranch');
        if(branchSelect) branchSelect.style.display = 'none';
    }
    
    // تحميل الفروع من السحابة
    await loadLabBranches();
    
    // تحميل إعدادات الطباعة
    await loadPrintSettings();
    
    await loadData(); 
    checkSyncStatus();
};