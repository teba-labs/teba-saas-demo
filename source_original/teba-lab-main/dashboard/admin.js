/* =====================================================
   TEBA LABS - Admin Logic (v2.0 - SaaS Multi-Tenant)
   ===================================================== */

(function(){
  'use strict';

  const supabaseUrl = TEBA_CONFIG.supabase.url;
  const supabaseKey = TEBA_CONFIG.supabase.key;
  const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

  /* ============= SECURITY CONSTANTS ============= */
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const BACKUP_VERSION = 'v123';

  let salesWorkbook = null;
  let pricesWorkbook = null;
  let detailedWorkbook2025 = null;
  let detailedWorkbook2026 = null;

  /* ============= THEME LOGIC ============= */
  window.toggleAdminTheme = function() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('teba_admin_theme', isLight ? 'light' : 'dark');
    document.getElementById('adminThemeToggle').textContent = isLight ? '🌙' : '☀️';
    updateChartsTheme();
  };

  function initTheme() {
    const savedTheme = localStorage.getItem('teba_admin_theme');
    const btn = document.getElementById('adminThemeToggle');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      if (btn) btn.textContent = '🌙';
    } else {
      if (btn) btn.textContent = '☀️';
    }
  }

  function updateChartsTheme() {
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#334155' : '#fff';
    const gridColor = isLight ? '#e2e8f0' : '#a8b5a8';
    const charts = [window.ovChart, window.finChart, window.anRevChart, window.anProfChart, window.casesChartInst, window.expensePieJaafaraChart, window.expensePieBahtimChart];
    charts.forEach(chart => {
      if (!chart) return;
      if (chart.options.plugins && chart.options.plugins.legend) chart.options.plugins.legend.labels.color = textColor;
      if (chart.options.scales) {
        if (chart.options.scales.x) chart.options.scales.x.ticks.color = gridColor;
        if (chart.options.scales.y) chart.options.scales.y.ticks.color = gridColor;
      }
      chart.update();
    });
  }

  /* ============= EXPORT LOGIC ============= */
  window.exportPDF = function(elementId, filename) {
    const element = document.getElementById(elementId);
    if (!element) return;
    if (element.innerHTML.trim() === '' || element.innerHTML.includes('جاري التحميل')) {
      alert('مفيش بيانات كفاية عشان ننزلها PDF. ارفع الملفات الأول.');
      return;
    }
    showLoading('جاري تجهيز ملف PDF...');
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `${filename}_${new Date().toISOString().slice(0,10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save().then(() => hideLoading()).catch(err => {
      hideLoading(); alert('حدث خطأ أثناء تصدير الـ PDF: ' + err.message);
    });
  };

  window.exportTableToExcel = function(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    showLoading('جاري تجهيز ملف Excel...');
    try {
      const wb = XLSX.utils.table_to_book(table, {sheet: "التقرير"});
      XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
      hideLoading();
    } catch (err) {
      hideLoading(); alert('حدث خطأ أثناء تصدير الـ Excel: ' + err.message);
    }
  };

  /* ============= PERFORMANCE: CACHE LAYER ============= */
  const _monthCache = new Map();
  const _yearCache = new Map();
  const _expenseBreakdownCache = new Map();
  let _mergedCache = {};
  let _testMovementCache = {};
  let _chartResizeTimer = null;

  function invalidateDataCache() {
    _monthCache.clear(); _yearCache.clear(); _expenseBreakdownCache.clear();
    _mergedCache = {}; 
    _testMovementCache = {};
  }

  function memoizeMap(cache, fn) {
    return function(...args) {
      const key = args.join('|');
      if (cache.has(key)) return cache.get(key);
      const result = fn.apply(this, args);
      cache.set(key, result);
      return result;
    };
  }

  const DB_NAME = 'TebaAdminDB_v16';
  const STORE_NAME = 'files';

  function openDB() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME); request.onsuccess = e => resolve(e.target.result); request.onerror = e => reject(e.target.error); }); }
  async function saveFileToDB(key, arrayBuffer) { const db = await openDB(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(arrayBuffer, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async function getFileFromDB(key) { const db = await openDB(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readonly'); const req = tx.objectStore(STORE_NAME).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  
  function num(v) { if (typeof v === 'number') return v; if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; } return 0; }
  function addMonths(year, month, delta) { let total = year * 12 + (month - 1) + delta; return { year: Math.floor(total / 12), month: (total % 12) + 1 }; }
  function calcMedian(arr) { if (!arr || arr.length === 0) return 0; const s = [...arr].sort((a,b) => a-b); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2; }
  function growthInfo(current, previous) { if (previous <= 0 || current <= 0) return { pct: 0, label: '—', color: '#94a3b8', icon: '' }; const pct = ((current - previous) / previous) * 100; return { pct, label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, color: pct >= 0 ? '#4ade80' : '#f87171', icon: pct >= 0 ? '↑' : '↓' }; }

  /* ============= VALIDATION & LOADING ============= */
  function validateFile(file) {
    if (!file) return { ok: false, msg: '❌ لم يتم اختيار ملف' };
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (allowed.indexOf(ext) === -1) return { ok: false, msg: '❌ نوع الملف غير مدعوم (' + ext + ')' };
    if (file.size > MAX_FILE_SIZE) return { ok: false, msg: '❌ حجم الملف أكبر من 20MB' };
    if (file.size === 0) return { ok: false, msg: '❌ الملف فارغ' };
    return { ok: true };
  }
  
  function validatePasswordStrength(pwd) {
    if (!pwd || pwd.length < 8) return { ok: false, msg: '❌ 8 أحرف على الأقل' };
    if (!/[A-Za-z]/.test(pwd)) return { ok: false, msg: '❌ لازم حروف' };
    if (!/[0-9]/.test(pwd)) return { ok: false, msg: '❌ لازم أرقام' };
    return { ok: true };
  }

  function showLoading(msg) {
    let el = document.getElementById('globalLoading');
    if (!el) { el = document.createElement('div'); el.id = 'globalLoading'; el.className = 'loading-overlay'; el.innerHTML = '<div class="loading-box"><div class="loading-spinner"></div><div class="loading-text"></div></div>'; document.body.appendChild(el); }
    el.querySelector('.loading-text').textContent = msg || 'جاري التحميل...'; el.classList.add('show');
  }
  function hideLoading() { const el = document.getElementById('globalLoading'); if (el) el.classList.remove('show'); }

  async function updateStorageIndicator() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return;
      const est = await navigator.storage.estimate();
      const used = est.usage || 0; const quota = est.quota || (60 * 1024 * 1024);
      const pct = Math.min(100, (used / quota) * 100);
      const fillClass = 'storage-bar-fill' + (pct > 80 ? ' danger' : pct > 60 ? ' warning' : '');
      const textContent = (used/1024/1024).toFixed(2) + ' MB / ' + (quota/1024/1024).toFixed(0) + ' MB (' + pct.toFixed(1) + '%)' + (pct > 80 ? ' ⚠️' : '');
      const bar = document.getElementById('storageBar'); const txt = document.getElementById('storageText');
      if (bar) { bar.style.width = pct.toFixed(1) + '%'; bar.className = fillClass; }
      if (txt) txt.textContent = textContent;
      const barSec = document.getElementById('storageBarSec'); const txtSec = document.getElementById('storageTextSec');
      if (barSec) { barSec.style.width = pct.toFixed(1) + '%'; barSec.className = fillClass; }
      if (txtSec) txtSec.textContent = textContent;
    } catch(e) {}
  }

  function updateLastUpdatedUI() {
    const el = document.getElementById('lastUpdatedText'); if (!el) return;
    const ts = localStorage.getItem('teba_last_upload_date');
    if (!ts) { el.innerHTML = '📅 آخر تحديث: لم يتم الرفع'; return; }
    const date = new Date(parseInt(ts, 10));
    el.innerHTML = `📅 آخر تحديث: ${date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  }  

  /* ============= BACKUP / RESTORE ============= */
  window.exportBackup = async function() {
    showLoading('جاري تصدير النسخة الاحتياطية...');
    try {
      const backup = { version: BACKUP_VERSION, timestamp: new Date().toISOString(), files: {}, settings: {} };
      const db = await openDB(); const tx = db.transaction(STORE_NAME, 'readonly'); const store = tx.objectStore(STORE_NAME);
      const keys = ['salesData', 'pricesData', 'detail2025Data', 'detail2026Data'];
      for (const k of keys) {
        const buf = await new Promise((res, rej) => { const r = store.get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        if (buf) { const bytes = new Uint8Array(buf); let bin = ''; for (let j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]); backup.files[k] = btoa(bin); }
      }
      backup.settings.lastUpload = localStorage.getItem('teba_last_upload_date');
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'teba-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(url);
      hideLoading(); alert('✅ تم تصدير النسخة الاحتياطية');
    } catch(e) { hideLoading(); alert('❌ خطأ: ' + e.message); }
  };

  window.importBackup = function() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async function(e) {
      const file = e.target.files[0]; if (!file) return;
      if (!confirm('⚠️ الاستيراد هيستبدل كل البيانات الحالية. متأكد؟')) return;
      showLoading('جاري استيراد النسخة...');
      try {
        const text = await file.text(); const backup = JSON.parse(text);
        if (!backup.version || !backup.files) throw new Error('ملف غير صالح');
        const db = await openDB(); const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME); store.clear();
        for (const [k, b64] of Object.entries(backup.files)) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j); store.put(arr.buffer, k); }
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        if (backup.settings && backup.settings.lastUpload) localStorage.setItem('teba_last_upload_date', backup.settings.lastUpload);
        hideLoading(); alert('✅ تم الاستيراد. الصفحة هتعيد التحميل.'); setTimeout(() => location.reload(), 500);
      } catch(e) { hideLoading(); alert('❌ خطأ: ' + e.message); }
    };
    input.click();
  };

  window.changeAdminPassword = async function() {
    const newPwd = prompt('كلمة المرور الجديدة (8+ أحرف، حروف وأرقام):'); if (!newPwd) return;
    const v = validatePasswordStrength(newPwd); if (!v.ok) { alert(v.msg); return; }
    const confirmPwd = prompt('أكد كلمة المرور:'); if (newPwd !== confirmPwd) { alert('❌ مش متطابقتين'); return; }
    
    showLoading('جاري تحديث كلمة المرور...');
    try {
      const { error } = await _supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      hideLoading(); alert('✅ تم تغيير كلمة المرور بنجاح!');
    } catch(err) {
      hideLoading(); alert('❌ خطأ: ' + err.message);
    }
  };  

  /* ============= REPORT NAVIGATION ============= */
  window.showReport = function(reportName){
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('report-' + reportName); if(target) target.classList.add('active');
    document.querySelectorAll('.admin-nav button').forEach(b => b.classList.toggle('active', b.dataset.report === reportName));
    
    if(reportName === 'reconciliation') renderReconciliation();
    if(reportName === 'live') renderLiveStats();
    if(reportName === 'overview') renderOverview();
    if(reportName === 'annual') renderAnnualReport();
    if(reportName === 'financial') renderFinancialReport();
    if(reportName === 'cases') renderCaseAnalysis();
    if(reportName === 'expenseBreakdown') renderExpenseBreakdown();
    if(reportName === 'bcg') renderBCGMatrix();
    if(reportName === 'monthlyPlan') renderMonthlyPlan();
    if(reportName === 'topSellers') renderTopSellers();
    if(reportName === 'mostProfitable') renderMostProfitable();
    if(reportName === 'leastProfitable') renderLeastProfitable();
    if(reportName === 'needOffers') renderNeedOffers();
    if(reportName === 'lossMakers') renderLossMakers();
    if(reportName === 'security') updateStorageIndicator();
    
    if(window.innerWidth <= 900) { 
        const sidebar = document.getElementById('adminSidebar'); 
        const overlay = document.getElementById('mobileOverlay'); 
        if(sidebar) sidebar.classList.remove('open'); 
        if(overlay) overlay.classList.remove('show'); 
    }
    if (_chartResizeTimer) clearTimeout(_chartResizeTimer);
    _chartResizeTimer = setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 200);
  };

  window.toggleAdminSidebar = function(){ 
      const sidebar = document.getElementById('adminSidebar'); 
      const overlay = document.getElementById('mobileOverlay'); 
      sidebar.classList.toggle('open'); 
      if(sidebar.classList.contains('open')){ overlay.classList.add('show'); } 
      else { overlay.classList.remove('show'); } 
  };

  async function showDashboard(){
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'flex';
    await loadSavedDataFromDB(); 
    updateLastUpdatedUI(); 
    window.showReport('reconciliation');
    if ('requestIdleCallback' in window) requestIdleCallback(() => updateStorageIndicator(), { timeout: 2000 }); 
    else setTimeout(updateStorageIndicator, 1500);
  }

  // ==== لوجيك الدخول الجديد (محمي بـ Supabase Auth & Roles) ====
  window.checkAdminPassword = async function(){
    const emailInput = document.getElementById('adminEmail');
    const passInput = document.getElementById('adminPassword');
    const error = document.getElementById('loginError'); 
    const btn = document.querySelector('.login-box button');
    
    if (!emailInput || !passInput || !error) return;
    
    if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحقق...'; }
    error.textContent = '';

    try {
      // 1. تسجيل الدخول من Supabase Auth
      const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passInput.value
      });

      if (authError) throw new Error('الإيميل أو الباسورد غير صحيح');

      // 2. التحقق من الصلاحيات (Role) من جدول الـ users
      const { data: userData, error: userError } = await _supabase
          .from('users')
          .select('role, tenant_id')
          .eq('id', authData.user.id)
          .single();

      if (userError || !userData) {
          await _supabase.auth.signOut();
          throw new Error('لا يوجد صلاحيات مسجلة لهذا الحساب.');
      }

      // التحقق إنه دكتور أو مالك
      if (userData.role !== 'admin' && userData.role !== 'owner') {
          await _supabase.auth.signOut();
          throw new Error('🔒 عذراً، هذا الحساب ليس لديه صلاحية الدخول للوحة التحكم.');
      }

      // 3. التأكد إنه بيحاول يدخل على الـ Tenant بتاعه
      if(userData.tenant_id !== TEBA_CONFIG.tenant.id) {
          await _supabase.auth.signOut();
          throw new Error('🔒 هذا الحساب يتبع لمعمل آخر.');
      }

      // تحديث البيانات في الذاكرة
      localStorage.setItem('teba_tenant_id', userData.tenant_id);
      localStorage.setItem('teba_user_role', userData.role);

      passInput.value = ''; 

    } catch(err) {
      error.textContent = '❌ ' + err.message;
      passInput.value = '';
      setTimeout(() => { error.textContent = ''; }, 4000);
    } finally { 
      if (btn) { btn.disabled = false; btn.textContent = 'دخول آمن'; } 
    }
  };

  window.logoutAdmin = async function(){ 
    await _supabase.auth.signOut(); 
  };

  window.clearData = async function() {
    if (!confirm('⚠️ مسح كل البيانات المحفوظة نهائياً؟')) return;
    if (!confirm('تأكيد نهائي: مفيش رجوع. متأكد 100%؟')) return;
    showLoading('جاري مسح البيانات...');
    try {
      salesWorkbook = null; pricesWorkbook = null; detailedWorkbook2025 = null; detailedWorkbook2026 = null;
      invalidateDataCache(); localStorage.removeItem('teba_last_upload_date');
      const db = await openDB(); const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).clear();
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      hideLoading(); alert('✅ تم مسح كل البيانات'); location.reload();
    } catch(e) { hideLoading(); alert('❌ خطأ: ' + e.message); }
  };

  window.handleFileUpload = async function(event, type){
    const file = event.target.files[0]; if (!file) return;
    const statusMap = { sales: 'uploadStatusSales', prices: 'uploadStatusPrices', detail2025: 'uploadStatusDetail2025', detail2026: 'uploadStatusDetail2026' };
    const dbKeyMap = { sales: 'salesData', prices: 'pricesData', detail2025: 'detail2025Data', detail2026: 'detail2026Data' };
    const statusEl = document.getElementById(statusMap[type]); if (!statusEl) return;
    const v = validateFile(file); if (!v.ok) { statusEl.className = 'upload-status error'; statusEl.textContent = v.msg; event.target.value = ''; return; }
    statusEl.className = 'upload-status'; statusEl.textContent = '⏳ جاري القراءة والحفظ...'; showLoading('جاري رفع ' + file.name);
    const reader = new FileReader();
    reader.onload = async function(e){
      try {
        const arrayBuffer = e.target.result; await saveFileToDB(dbKeyMap[type], arrayBuffer); const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        statusEl.className = 'upload-status success'; statusEl.innerHTML = '✅ تم رفع وحفظ الملف بنجاح!';
        if(type === 'sales') salesWorkbook = workbook; if(type === 'prices') pricesWorkbook = workbook;
        if(type === 'detail2025') detailedWorkbook2025 = workbook; if(type === 'detail2026') detailedWorkbook2026 = workbook;
        localStorage.setItem('teba_last_upload_date', Date.now()); updateLastUpdatedUI(); invalidateDataCache(); updateStorageIndicator(); hideLoading();
      } catch (err) { statusEl.className = 'upload-status error'; statusEl.textContent = '❌ خطأ: ' + err.message; hideLoading(); }
    };
    reader.onerror = function(){ statusEl.className = 'upload-status error'; statusEl.textContent = '❌ فشل قراءة الملف'; hideLoading(); }; reader.readAsArrayBuffer(file);
  };

  async function loadSavedDataFromDB() {
    showLoading('جاري تحميل البيانات المحفوظة...');
    try {
      invalidateDataCache();
      const [salesBuffer, pricesBuffer, detail2025Buffer, detail2026Buffer] = await Promise.all([ getFileFromDB('salesData'), getFileFromDB('pricesData'), getFileFromDB('detail2025Data'), getFileFromDB('detail2026Data') ]);
      if(salesBuffer) { salesWorkbook = XLSX.read(salesBuffer, { type: 'array' }); const el = document.getElementById('uploadStatusSales'); if (el) { el.className = 'upload-status success'; el.innerHTML = '✅ ملف المبيعات محمل.'; } }
      if(pricesBuffer) { pricesWorkbook = XLSX.read(pricesBuffer, { type: 'array' }); const el = document.getElementById('uploadStatusPrices'); if (el) { el.className = 'upload-status success'; el.innerHTML = '✅ ملف الأسعار محمل.'; } }
      if(detail2025Buffer) { detailedWorkbook2025 = XLSX.read(detail2025Buffer, { type: 'array' }); const el = document.getElementById('uploadStatusDetail2025'); if (el) { el.className = 'upload-status success'; el.innerHTML = '✅ تفصيل 2025 محمل.'; } }
      if(detail2026Buffer) { detailedWorkbook2026 = XLSX.read(detail2026Buffer, { type: 'array' }); const el = document.getElementById('uploadStatusDetail2026'); if (el) { el.className = 'upload-status success'; el.innerHTML = '✅ تفصيل 2026 محمل.'; } }
      hideLoading();
    } catch(e) { hideLoading(); console.log("لا توجد بيانات محفوظة.", e); }
  }  

  function getSheetData(sheetKey) { 
    if (!salesWorkbook) return []; 
    const sheetName = salesWorkbook.SheetNames.find(n => n.includes(sheetKey)); 
    if (!sheetName) return []; 
    return XLSX.utils.sheet_to_json(salesWorkbook.Sheets[sheetName], { header: 1, defval: "" }); 
  }      const extractYearData = memoizeMap(_yearCache, function(year, branch) {
    const annualData = getSheetData('السنوية'); let totalRev = 0, totalExp = 0;
    for (let i = 1; i < annualData.length; i++) { 
        let row = annualData[i]; if (!row) continue; 
        if (String(row[5]).trim() === String(year).trim() && String(row[4]).trim() === String(branch).trim()) { 
            totalRev += Number(row[3]) || 0; totalExp += Number(row[2]) || 0; 
        } 
    }
    return { rev: totalRev, exp: totalExp };
  });

  const extractMonthData = memoizeMap(_monthCache, function(year, month, branch) {
    const monthlyData = getSheetData('الشهرية'); let totalRev = 0, totalExp = 0, totalCases = 0;
    for (let i = 1; i < monthlyData.length; i++) { 
        let row = monthlyData[i]; if (!row) continue; 
        if (String(row[7]).trim() === String(year).trim() && String(row[6]).trim() === String(branch).trim()) { 
            if (!month || month === 'all' || month === '' || String(row[4]).trim() === String(month).trim()) { 
                if (String(row[4]).trim() !== 'التقفيل' && String(row[4]).trim() !== '') { 
                    totalRev += Number(row[3]) || 0; totalExp += Number(row[2]) || 0; totalCases += Number(row[5]) || 0; 
                } 
            } 
        } 
    }
    return { rev: totalRev, exp: totalExp, cases: totalCases };
  });

  function findLatestReportMonth() {
    const now = new Date(); let year = now.getFullYear(); let month = now.getMonth() + 1;
    for (let i = 0; i < 120; i++) { 
        const d1 = extractMonthData(year, month, 'الجعافرة'); 
        const d2 = extractMonthData(year, month, 'بهتيم'); 
        if (d1.rev > 0 || d2.rev > 0) return { year, month }; 
        month--; if (month < 1) { month = 12; year--; } 
    }
    return null;
  }

  function getTestMovementData(branch, targetMonth = null) {
    const cacheKey = (branch === 'الجعافرة' ? 'jaafara' : 'bahtim') + (targetMonth ? '_' + targetMonth : '');
    if (_testMovementCache[cacheKey]) return _testMovementCache[cacheKey];
    const sheetKey = branch === 'الجعافرة' ? 'تكرار التحاليل فرع الجعافرة' : 'تكرار التحاليل فرع بهتيم';
    const data = getSheetData(sheetKey); 
    const testData = [];
    for (let i = 2; i < data.length; i++) { 
      const row = data[i]; 
      if (row && row[0] && typeof row[0] === 'string' && row[0].trim() !== '') { 
        const rowMonth = Number(row[1]);
        if (targetMonth && rowMonth !== Number(targetMonth)) continue; 
        const count = Number(row[2]) || 0; 
        testData.push({ name: row[0].trim(), count: count }); 
      } 
    }
    _testMovementCache[cacheKey] = testData; 
    return testData;
  }

  function getMergedData(branchFilter = 'combined', monthFilter = 'latest') {
    const cacheKey = branchFilter + '_' + monthFilter;
    if (_mergedCache[cacheKey]) return _mergedCache[cacheKey];
    if (!pricesWorkbook) return [];
    
    const priceSheetName = pricesWorkbook.SheetNames.find(n => n.includes('التحاليل')) || pricesWorkbook.SheetNames[0];
    const priceData = XLSX.utils.sheet_to_json(pricesWorkbook.Sheets[priceSheetName], { header: 1, defval: "" });
    const priceMap = {};
    for (let i = 1; i < priceData.length; i++) {
      const row = priceData[i];
      if (row && row[0]) {
        const testName = String(row[0]).trim().toLowerCase();
        const type = row[1] ? String(row[1]).trim() : 'خارجي';
        const baseCost = Number(row[2]) || 0;
        const weight = Number(row[3]) || 1; 
        const sellPrice = Number(row[4]) || 0; 
        if (sellPrice > 0) priceMap[testName] = { type, baseCost, weight, sellPrice };
      }
    }

    let period = null;
    if (monthFilter === 'latest') {
      period = findLatestReportMonth();
    } else {
      const [yr, mn] = monthFilter.split('-');
      period = { year: yr, month: mn };
    }

    let dJ = { exp: 0 }, dB = { exp: 0 };
    if (period) {
      dJ = extractMonthData(period.year, period.month, 'الجعافرة');
      dB = extractMonthData(period.year, period.month, 'بهتيم');
    }
    
    function calcBranch(branchName, branchExp) {
      const tests = getTestMovementData(branchName, period ? period.month : null);
      if (!tests || tests.length === 0) return { list: [] };
      
      let totalVariableCost = 0;
      let totalPoints = 0;
      const branchList = [];
      
      tests.forEach(t => {
        const searchName = t.name.trim().toLowerCase();
        if (priceMap[searchName]) {
          const { type, baseCost, weight, sellPrice } = priceMap[searchName];
          totalVariableCost += (baseCost * t.count);
          totalPoints += (weight * t.count);
          branchList.push({ name: t.name, count: t.count, type, baseCost, weight, sell: sellPrice });
        }
      });
      
      let totalFixedCost = 0;
      if (period) {
          const breakdown = extractExpenseBreakdown(period.year, period.month, branchName);
          if (breakdown) {
              totalFixedCost = breakdown.chemicals + breakdown.salaries;
              if (breakdown.misc) Object.values(breakdown.misc).forEach(v => totalFixedCost += v);
          }
      }
      
      if (totalFixedCost === 0 && branchExp > 0) {
          totalFixedCost = Math.max(0, branchExp - totalVariableCost);
      }
      
      const pointValue = totalPoints > 0 ? (totalFixedCost / totalPoints) : 0;
      
      branchList.forEach(t => {
        t.trueCost = t.baseCost + (t.weight * pointValue);
        t.trueProfitUnit = t.sell - t.trueCost;
        t.trueTotalProfit = t.trueProfitUnit * t.count;
      });
      
      return { list: branchList };
    }

    if (branchFilter === 'jaafara') {
      const res = calcBranch('الجعافرة', dJ.exp);
      _mergedCache[cacheKey] = res.list;
      return res.list;
    } 
    else if (branchFilter === 'bahtim') {
      const res = calcBranch('بهتيم', dB.exp);
      _mergedCache[cacheKey] = res.list;
      return res.list;
    } 
    else {
      const resJ = calcBranch('الجعافرة', dJ.exp);
      const resB = calcBranch('بهتيم', dB.exp);
      const combinedList = [];
      const map = new Map();
      [...resJ.list, ...resB.list].forEach(t => {
        const key = t.name.toLowerCase();
        if (!map.has(key)) map.set(key, { ...t, count: 0, trueTotalProfit: 0 });
        const existing = map.get(key);
        existing.count += t.count;
        existing.trueTotalProfit += t.trueTotalProfit;
      });
      map.forEach(t => {
        t.trueProfitUnit = t.count > 0 ? t.trueTotalProfit / t.count : 0;
        t.trueCost = t.sell - t.trueProfitUnit;
        combinedList.push(t);
     });

      _mergedCache[cacheKey] = combinedList;
      return combinedList;
    }
  }

  // ==== المطابقة الشهرية (Live vs Excel) ====
  window.renderReconciliation = async function() {
    if (!salesWorkbook) {
      document.getElementById('recon-approval-area').innerHTML = '<p style="color:red; font-weight:bold; font-size:1.2rem;">⚠️ ارفع ملف المتابعة السنوية أولاً (من تاب رفع الملفات).</p>';
      return;
    }
    const year = document.getElementById('reconYearSelector').value;
    const month = document.getElementById('reconMonthSelector').value;
    const branchFilter = document.getElementById('reconBranchSelector').value;
    document.getElementById('recon-year-title').innerText = year;

    showLoading('جاري حساب المطابقة...');

    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      
      let query = _supabase.from('visits').select('*')
        .eq('tenant_id', TEBA_CONFIG.tenant.id)
        .gte('visit_date', startDate.toISOString())
        .lte('visit_date', endDate.toISOString());
      
      if (branchFilter === 'jaafara') query = query.eq('branch_id', 1);
      if (branchFilter === 'bahtim') query = query.eq('branch_id', 2);

      const { data: visits, error } = await query;
      if (error) throw error;

      const liveCases = visits ? visits.length : 0;
      const liveRevenue = visits ? visits.reduce((sum, v) => sum + parseFloat(v.paid_amount || 0), 0) : 0;

      let excelCases = 0, excelRevenue = 0;
      if (branchFilter === 'combined') {
        const dJ = extractMonthData(year, month, 'الجعافرة');
        const dB = extractMonthData(year, month, 'بهتيم');
        excelCases = dJ.cases + dB.cases;
        excelRevenue = dJ.rev + dB.rev;
      } else if (branchFilter === 'jaafara') {
        const dJ = extractMonthData(year, month, 'الجعافرة');
        excelCases = dJ.cases;
        excelRevenue = dJ.rev;
      } else {
        const dB = extractMonthData(year, month, 'بهتيم');
        excelCases = dB.cases;
        excelRevenue = dB.rev;
      }

      const diffCases = liveCases - excelCases;
      const diffRevenue = liveRevenue - excelRevenue;

      document.getElementById('recon-live-revenue').innerText = liveRevenue.toLocaleString() + ' ج';
      document.getElementById('recon-live-cases').innerText = liveCases + ' حالة';
      
      document.getElementById('recon-excel-revenue').innerText = excelRevenue.toLocaleString() + ' ج';
      document.getElementById('recon-excel-cases').innerText = excelCases + ' حالة';
      
      const diffRevEl = document.getElementById('recon-diff-revenue');
      const diffCasesEl = document.getElementById('recon-diff-cases');
      
      diffRevEl.innerText = (diffRevenue > 0 ? '+' : '') + diffRevenue.toLocaleString() + ' ج';
      diffCasesEl.innerText = (diffCases > 0 ? '+' : '') + diffCases + ' حالة';
      
      let diffColor = '#16a34a';
      if (diffRevenue !== 0 || diffCases !== 0) diffColor = '#f59e0b';
      if (Math.abs(diffRevenue) > 1000 || Math.abs(diffCases) > 10) diffColor = '#dc2626';
      
      diffRevEl.style.color = diffColor;
      diffCasesEl.style.color = diffColor;

      const { data: approval } = await _supabase.from('monthly_approvals').select('*')
        .eq('tenant_id', TEBA_CONFIG.tenant.id)
        .eq('year', year)
        .eq('month', month)
        .single();
      
      const approvalArea = document.getElementById('recon-approval-area');
      if (approval) {
        approvalArea.innerHTML = `<div style="background: rgba(22, 163, 74, 0.1); border: 2px solid #16a34a; color: #16a34a; padding: 15px; border-radius: 12px; font-size: 1.1rem; font-weight: bold;">
          ✅ معتمد من: ${approval.approved_by} <br>
          <span style="font-size: 0.9rem; font-weight: normal;">بتاريخ: ${new Date(approval.approved_at).toLocaleString('ar-EG')}</span>
        </div>`;
      } else {
        approvalArea.innerHTML = `<button class="btn-export" style="background: linear-gradient(135deg, #16a34a, #15803d); font-size: 1.2rem; padding: 15px 40px;" onclick="approveMonth(${year}, ${month})">✅ اعتماد الشهر</button>`;
      }

      renderYearGrid(year);

    } catch(err) {
      console.error(err);
      alert('حدث خطأ أثناء المطابقة: ' + err.message);
    } finally {
      hideLoading();
    }
  };

  window.approveMonth = async function(year, month) {
    if (!confirm('هل أنت متأكد من اعتماد هذا الشهر؟')) return;
    showLoading('جاري حفظ الاعتماد...');
    try {
      const { error } = await _supabase.from('monthly_approvals').upsert({
        tenant_id: TEBA_CONFIG.tenant.id,
        year: parseInt(year),
        month: parseInt(month),
        approved_by: TEBA_CONFIG.lab.doctor,
        status: 'approved'
      }, { onConflict: 'tenant_id,year,month' });

      if (error) throw error;
      alert('✅ تم اعتماد الشهر بنجاح!');
      renderReconciliation();
    } catch(err) {
      alert('❌ خطأ أثناء الاعتماد: ' + err.message);
    } finally {
      hideLoading();
    }
  };

  async function renderYearGrid(year) {
    const grid = document.getElementById('recon-year-grid');
    grid.innerHTML = 'جاري التحميل...';
    const { data: approvals } = await _supabase.from('monthly_approvals').select('month')
      .eq('tenant_id', TEBA_CONFIG.tenant.id)
      .eq('year', year);
    const approvedMonths = (approvals || []).map(a => a.month);
    const monthsAr = ['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
    grid.innerHTML = monthsAr.map((name, idx) => {
      const m = idx + 1;
      let boxClass = 'gray';
      if (approvedMonths.includes(m)) {
        boxClass = 'green';
      } else {
        const dJ = extractMonthData(year, m, 'الجعافرة');
        const dB = extractMonthData(year, m, 'بهتيم');
        if (dJ.cases > 0 || dB.cases > 0 || dJ.rev > 0 || dB.rev > 0) boxClass = 'yellow';
      }
      return `<div class="year-box ${boxClass}" onclick="document.getElementById('reconMonthSelector').value=${m}; renderReconciliation();">
        ${name}<br><span style="font-size:0.7rem;">${boxClass === 'green' ? 'معتمد ✅' : boxClass === 'yellow' ? 'محتاج مراجعة ⚠️' : 'لا يوجد بيانات ⚪'}</span>
      </div>`;
    }).join('');
  }  

  // ==== الإحصائيات المباشرة (Live Stats) - [تم إصلاح مشكلة الدبل هنا] ====
  async function getBranchLiveStats(branchId) {
      const today = new Date(); today.setHours(0,0,0,0); const todayISO = today.toISOString();
      
      // 1. جلب عدد الحالات من جدول الزيارات
      let query = _supabase.from('visits').select('visit_id, is_published').eq('tenant_id', TEBA_CONFIG.tenant.id).gte('visit_date', todayISO);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data: visits, error: vErr } = await query;
      
      if (vErr) throw vErr;

      const casesCount = visits ? visits.length : 0;
      const pubCount = visits ? visits.filter(v => v.is_published === true).length : 0; 
      
      const vIds = visits ? visits.map(v => v.visit_id) : [];
      
      let testsCount = 0, pendingCount = 0;
      if (vIds.length > 0) {
          const { data: vt, error: vtErr } = await _supabase.from('visit_tests').select('id').eq('tenant_id', TEBA_CONFIG.tenant.id).in('visit_id', vIds);
          if (vtErr) throw vtErr;
          
          testsCount = vt ? vt.length : 0;
          const vtIds = vt ? vt.map(v => v.id) : [];
          
          if (vtIds.length > 0) {
              const { data: res, error: resErr } = await _supabase.from('test_results').select('visit_test_id').eq('tenant_id', TEBA_CONFIG.tenant.id).in('visit_test_id', vtIds);
              if (resErr) throw resErr;
              
              const resIds = new Set((res||[]).map(r => r.visit_test_id));
              pendingCount = vtIds.filter(id => !resIds.has(id)).length;
          }
      }

      // 2. جلب المالية من جدول الخزنة (financial_ledger) فقط - لمنع الدبل
      let finQuery = _supabase.from('financial_ledger').select('amount, type').eq('tenant_id', TEBA_CONFIG.tenant.id).gte('created_at', todayISO);
      if (branchId) finQuery = finQuery.eq('branch_id', branchId);
      const { data: finData, error: finErr } = await finQuery;
      
      let liveRev = 0; // بدأنا من صفر عشان منجمعش الفلوس مرتين
      let liveExp = 0;
      
      if (!finErr && finData) {
          finData.forEach(f => {
              if (f.type === 'revenue') liveRev += parseFloat(f.amount);
              else liveExp += parseFloat(f.amount);
          });
      }
      
      return { cases: casesCount, rev: liveRev, exp: liveExp, tests: testsCount, pending: pendingCount, published: pubCount };
  }

  window.renderLiveStats = async function() {
      ['all','j','b'].forEach(p => {
          ['cases','tests','rev','exp','pending','published'].forEach(m => {
              const el = document.getElementById(`live-${m}-${p}`); if(el) el.innerText = '...';
          });
      });

      try {
          const [statsAll, statsJ, statsB] = await Promise.all([
              getBranchLiveStats(null),
              getBranchLiveStats(1),
              getBranchLiveStats(2)
          ]);

          const updateDOM = (prefix, data) => {
              const elC = document.getElementById(`live-cases-${prefix}`); if(elC) elC.innerText = data.cases;
              const elT = document.getElementById(`live-tests-${prefix}`); if(elT) elT.innerText = data.tests;
              const elR = document.getElementById(`live-rev-${prefix}`); if(elR) elR.innerText = data.rev.toLocaleString() + ' ج';
              const elE = document.getElementById(`live-exp-${prefix}`); if(elE) elE.innerText = data.exp.toLocaleString() + ' ج';
              const elP = document.getElementById(`live-pending-${prefix}`); if(elP) elP.innerText = data.pending;
              const elPub = document.getElementById(`live-published-${prefix}`); if(elPub) elPub.innerText = data.published;
          };

          updateDOM('all', statsAll);
          updateDOM('j', statsJ);
          updateDOM('b', statsB);

      } catch(err) {
          console.error("Live Stats Error:", err);
          ['all','j','b'].forEach(p => {
              ['cases','tests','rev','exp','pending','published'].forEach(m => {
                  const el = document.getElementById(`live-${m}-${p}`); if(el) el.innerText = '!';
              });
          });
      }
  };    // ==== رسالة المستشار (في تاب النظرة العامة) ====
  window.renderMonthlyAdvisor = function() {    
    const container = document.getElementById('advisorReport');
    if (!container) return;
    if (!salesWorkbook) { container.innerHTML = '<div class="advisor-card"><div class="advisor-card-title">👨‍⚕️ رسالة المستشار</div><div class="advisor-card-body">⚠️ ارفع ملف المتابعة السنوية أولاً عشان يظهر التقرير الشهري.</div></div>'; return; }
    const period = findLatestReportMonth();
    if (!period) { container.innerHTML = '<div class="advisor-card"><div class="advisor-card-title">👨‍⚕️ رسالة المستشار</div><div class="advisor-card-body">ℹ️ مفيش بيانات شهرية كافية لعرض التقرير.</div></div>'; return; }
    
    const monthsAr = ['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
    const monthName = monthsAr[period.month - 1];
    const currJ = extractMonthData(period.year, period.month, 'الجعافرة');
    const currB = extractMonthData(period.year, period.month, 'بهتيم');
    const currRev = currJ.rev + currB.rev; const currExp = currJ.exp + currB.exp;
    const currCases = currJ.cases + currB.cases; const currProfit = currRev - currExp;
    
    let prevMonth = period.month - 1, prevYear = period.year; if (prevMonth < 1) { prevMonth = 12; prevYear--; }
    const prevJ = extractMonthData(prevYear, prevMonth, 'الجعافرة'); const prevB = extractMonthData(prevYear, prevMonth, 'بهتيم');
    const prevRev = prevJ.rev + prevB.rev; const prevProfit = (prevJ.rev + prevB.rev) - (prevJ.exp + prevB.exp);
    const lastYrJ = extractMonthData(period.year - 1, period.month, 'الجعافرة'); const lastYrB = extractMonthData(period.year - 1, period.month, 'بهتيم');
    const lastYrRev = lastYrJ.rev + lastYrB.rev; const lastYrProfit = (lastYrJ.rev + lastYrB.rev) - (lastYrJ.exp + lastYrB.exp);

    let seasonalRevJ = 0, seasonalRevB = 0, seasonalCount = 0;
    for (let y = period.year - 1; y >= 2023; y--) {
      const sJ = extractMonthData(y, period.month, 'الجعافرة'); const sB = extractMonthData(y, period.month, 'بهتيم');
      if (sJ.rev > 0 || sB.rev > 0) { seasonalRevJ += sJ.rev; seasonalRevB += sB.rev; seasonalCount++; }
    }
    const avgSeasonalRevCombined = (seasonalCount > 0 ? (seasonalRevJ + seasonalRevB) / seasonalCount : 0);
    
    const revMoM = growthInfo(currRev, prevRev); const revYoY = growthInfo(currRev, lastYrRev); const revSeasonal = growthInfo(currRev, avgSeasonalRevCombined);
    const jMoM = growthInfo(currJ.rev, prevJ.rev); const bMoM = growthInfo(currB.rev, prevB.rev); const jYoY = growthInfo(currJ.rev, lastYrJ.rev); const bYoY = growthInfo(currB.rev, lastYrB.rev);

    const now = new Date(); const isCurrentMonth = (period.year === now.getFullYear() && period.month === (now.getMonth() + 1));
    const periodNote = isCurrentMonth ? '' : `<div class="advisor-period-note">ℹ️ الشهر الحالي لسه مكتملش، فالتقرير بيعرض <strong>آخر شهر مكتمل (${monthName} ${period.year})</strong>.</div>`;
    
    const recs = [];
    let labStatus = 'مستقر'; let labStatusColor = '#fbbf24';
    if (revMoM.pct > 5 && revYoY.pct > 5) { labStatus = 'في نمو قوي 📈'; labStatusColor = '#16a34a'; }
    else if (revMoM.pct < -5 && revYoY.pct < -5) { labStatus = 'في تراجع يحتاج تدخل 📉'; labStatusColor = '#f87171'; }
    else if (revMoM.pct > 0) { labStatus = 'في تحسن طفيف ↗️'; labStatusColor = '#4ade80'; }

    recs.push(`<strong>حالة المعمل الإجمالية:</strong> معملك <span style="color:${labStatusColor}; font-weight:900;">${labStatus}</span> بناءً على مقارنة الإيرادات.`);
    recs.push(`📊 <strong>الشهر (${monthName}):</strong> إيرادك ${currRev.toLocaleString()} ج. مقارنة بـ:<br>- الشهر اللي فات: <span style="color:${revMoM.color}">${revMoM.icon} ${revMoM.label}</span><br>- نفس الشهر العام الماضي: <span style="color:${revYoY.color}">${revYoY.icon} ${revYoY.label}</span><br>- المتوقع موسمياً: <span style="color:${revSeasonal.color}">${revSeasonal.icon} ${revSeasonal.label}</span>`);
    recs.push(`🏥 <strong>فرع الجعافرة:</strong> إيراد ${currJ.rev.toLocaleString()} ج.<br>- عن الشهر السابق: <span style="color:${jMoM.color}">${jMoM.icon} ${jMoM.label}</span><br>- عن العام الماضي: <span style="color:${jYoY.color}">${jYoY.icon} ${jYoY.label}</span>`);
    recs.push(`🏥 <strong>فرع بهتيم:</strong> إيراد ${currB.rev.toLocaleString()} ج.<br>- عن الشهر السابق: <span style="color:${bMoM.color}">${bMoM.icon} ${bMoM.label}</span><br>- عن العام الماضي: <span style="color:${bYoY.color}">${bYoY.icon} ${bYoY.label}</span>`);

    if (revSeasonal.pct < -15) { recs.push(`⚠️ <strong>تنبيه موسمي:</strong> إيراد الشهر ده أقل من المتوقع بناءً على تاريخ السنين اللي فاتت.`); }
    else if (revSeasonal.pct > 15) { recs.push(`🔥 <strong>إنجاز:</strong> إنت كسرت التوقع الموسمي لشهر ${monthName}!`); }

    const messageHtml = `<div class="advisor-card"><div class="advisor-card-title">👨‍⚕️ رسالة المستشار <span class="advisor-period-badge">${monthName} ${period.year}</span></div>${periodNote}<div class="advisor-card-body">أهلاً يا دكتور،<br>تقرير <strong>${monthName} ${period.year}</strong> جاهز. الشهر ده حقق: <strong>${currRev.toLocaleString()} ج</strong> إيراد، <strong>${currProfit.toLocaleString()} ج</strong> ربح، و<strong>${currCases.toLocaleString()} حالة</strong>.<ul class="advisor-rec-list">${recs.map(r => `<li class="advisor-rec-item">${r}</li>`).join('')}</ul></div></div>`;
    
    const finCompareHtml = `<div class="advisor-section"><h4>💰 مقارنة مالية</h4><div class="advisor-compare-grid"><div class="advisor-compare-card"><div class="advisor-compare-label">الشهر الحالي (${monthName} ${period.year})</div><div class="advisor-compare-value" style="color:#16a34a;">${currRev.toLocaleString()} ج</div><div class="advisor-compare-growth" style="color:#94a3b8;">إيراد</div><div class="advisor-compare-profit">ربح ${currProfit.toLocaleString()} ج</div></div><div class="advisor-compare-card"><div class="advisor-compare-label">الشهر اللي فات (${monthsAr[prevMonth-1]} ${prevYear})</div><div class="advisor-compare-value" style="color:#00bfff;">${prevRev.toLocaleString()} ج</div><div class="advisor-compare-growth" style="color:${revMoM.color};">${revMoM.icon} ${revMoM.label}</div><div class="advisor-compare-profit">ربح ${prevProfit.toLocaleString()} ج</div></div><div class="advisor-compare-card"><div class="advisor-compare-label">نفس الشهر السنة اللي فاتت</div><div class="advisor-compare-value" style="color:#a78bfa;">${lastYrRev.toLocaleString()} ج</div><div class="advisor-compare-growth" style="color:${revYoY.color};">${revYoY.icon} ${revYoY.label} YoY</div><div class="advisor-compare-profit">ربح ${lastYrProfit.toLocaleString()} ج</div></div></div></div>`;
    const branchCompareHtml = `<div class="advisor-section"><h4>🏥 مقارنة الفروع</h4><div class="advisor-branch-grid">${['الجعافرة', 'بهتيم'].map(branch => { const d = branch === 'الجعافرة' ? currJ : currB; const prevD = branch === 'الجعافرة' ? prevJ : prevB; const g = growthInfo(d.rev, prevD.rev); const bMargin = d.rev > 0 ? ((d.rev - d.exp) / d.rev * 100) : 0; const status = bMargin >= 50 ? '✅ ممتاز' : bMargin >= 35 ? '👍 كويس' : '⚠️ محتاج مراجعة'; const statusColor = bMargin >= 50 ? '#16a34a' : bMargin >= 35 ? '#d97706' : '#dc2626'; return `<div class="advisor-branch-card"><h5>🏥 ${branch} <span style="color:${statusColor}; font-size:0.8rem;">${status}</span></h5><div class="advisor-branch-row"><span>الإيراد</span><strong style="color:#16a34a;">${d.rev.toLocaleString()} ج</strong></div><div class="advisor-branch-row"><span>المصروفات</span><strong style="color:#dc2626;">${d.exp.toLocaleString()} ج</strong></div><div class="advisor-branch-row"><span>الربح</span><strong style="color:#d97706;">${(d.rev - d.exp).toLocaleString()} ج</strong></div><div class="advisor-branch-row"><span>الحالات</span><strong style="color:#0284c7;">${d.cases.toLocaleString()}</strong></div><div class="advisor-branch-row"><span>التغير</span><strong style="color:${g.color};">${g.icon} ${g.label}</strong></div></div>`; }).join('')}</div></div>`;
    
    let testsHtml = '';
    const merged = getMergedData('combined');
    if (merged.length > 0) {
      const topSellers = [...merged].sort((a, b) => b.count - a.count).slice(0, 3);
      const topProfitable = [...merged].sort((a, b) => b.trueTotalProfit - a.trueTotalProfit).slice(0, 3);
      const topLosing = [...merged].filter(t => t.trueProfitUnit < 0).sort((a, b) => a.trueProfitUnit - b.trueProfitUnit).slice(0, 3);
      testsHtml = `<div class="advisor-section"><h4>🔬 أهم التحاليل (بالربح الصافي)</h4><div class="advisor-tests-grid"><div class="advisor-test-card"><h5 style="color:#0284c7;">🏆 الأكثر مبيعاً</h5>${topSellers.length > 0 ? topSellers.map(t => `<div class="advisor-test-item"><span class="advisor-test-name">${t.name}</span><span class="advisor-test-value" style="color:#0284c7;">${t.count}×</span></div>`).join('') : '<p style="color:var(--text-muted); font-size:0.85rem; text-align:center;">لا توجد بيانات</p>'}</div><div class="advisor-test-card"><h5 style="color:#16a34a;">💎 الأكثر ربحاً</h5>${topProfitable.length > 0 ? topProfitable.map(t => `<div class="advisor-test-item"><span class="advisor-test-name">${t.name}</span><span class="advisor-test-value" style="color:#16a34a;">${t.trueTotalProfit.toLocaleString()} ج</span></div>`).join('') : '<p style="color:var(--text-muted); font-size:0.85rem; text-align:center;">لا توجد بيانات</p>'}</div><div class="advisor-test-card"><h5 style="color:#dc2626;">📉 الأكثر خسارة</h5>${topLosing.length > 0 ? topLosing.map(t => `<div class="advisor-test-item"><span class="advisor-test-name">${t.name}</span><span class="advisor-test-value" style="color:#dc2626;">${t.trueProfitUnit} ج</span></div>`).join('') : '<p style="color:var(--text-muted); font-size:0.85rem; text-align:center;">مفيش تحاليل خاسرة ✅</p>'}</div></div></div>`;
    } else { testsHtml = `<div class="advisor-section"><h4>🔬 أهم التحاليل</h4><p style="color:var(--text-muted); text-align:center; padding:15px;">ارفع ملف الأسعار عشان تشوف أهم التحاليل.</p></div>`; }
    
    const alerts = [];
    const margin = currRev > 0 ? (currProfit / currRev) * 100 : 0;
    if (margin < 30) alerts.push(`💸 هامش الربح ${margin.toFixed(1)}% — تحت الحد الآمن (30%).`);
    if (revMoM.pct < -15) alerts.push(`📉 الإيراد نزل ${Math.abs(revMoM.pct).toFixed(1)}% عن الشهر اللي فات.`);
    if (currJ.rev > 0 && (currJ.rev - currJ.exp) < 0) alerts.push(`⚠️ فرع الجعافرة خاسر الشهر ده!`);
    if (currB.rev > 0 && (currB.rev - currB.exp) < 0) alerts.push(`⚠️ فرع بهتيم خاسر الشهر ده!`);
    if (merged.length > 0) { const losingCount = merged.filter(t => t.trueProfitUnit < 0).length; if (losingCount >= 5) alerts.push(`📉 عندك ${losingCount} تحليل خاسر بعد حساب التكلفة الحقيقية.`); }
    const alertsHtml = alerts.length > 0 ? `<div class="advisor-alert-critical"><h4>🚨 تنبيهات حرجة</h4>${alerts.map(a => `<div class="advisor-alert-item">${a}</div>`).join('')}</div>` : '';
    
    container.innerHTML = messageHtml + finCompareHtml + branchCompareHtml + testsHtml + alertsHtml;
  };  

  // ==== دوال بناء خطة الشهر ====
  function buildWeeklyPlan(ctx) {
    const weeks = [];
    const { refMonthName, refMargin, refExp, losingTests, sleepingTests, topSellers, refRev, refExpRatio, avgInvoice, jRevGrowth, bRevGrowth, refJMargin, refBMargin } = ctx;
    const weakerBranch = refJMargin < refBMargin ? 'الجعافرة' : 'بهتيم';
    const weakerGrowth = refJMargin < refBMargin ? jRevGrowth : bRevGrowth;
    const targetAvg = Math.round(avgInvoice * 1.08);
    const w1 = { icon: '⚡', title: 'إصلاحات عاجلة', badge: 'إصلاح', goal: '', actions: [], success: '' };
    if (refMargin < 30) {
      w1.goal = `رفع الهامش من ${refMargin.toFixed(1)}% لـ 30%+`;
      w1.actions.push(`🚨 راجع أعلى 3 بنود مصاريف في ${refMonthName} (إجمالي ${refExp.toLocaleString()} ج) وقللهم 10% = توفير ${(refExp * 0.10).toLocaleString()} ج`);
      if (losingTests.length > 0) w1.actions.push(`💸 ارفع سعر أو أوقف "${losingTests[0].name}" (خسارة صافية ${Math.abs(losingTests[0].trueProfitUnit)} ج/تحليل)`);
      w1.success = `الهامش ≥ 28%`;
    } else if (refMargin < 40) {
      w1.goal = `تحسين الهامش من ${refMargin.toFixed(1)}% لـ 40%+`;
      w1.actions.push(`📊 حلل بنود المصاريف وحدد بند لتخفيضه 10-15%`);
      w1.actions.push(`💡 راجع التحاليل الأقل ربحاً وارفع أسعارها 5-10%`);
      w1.success = `الهامش ≥ ${(refMargin + 3).toFixed(0)}%`;
    } else {
      w1.goal = `الحفاظ على الهامش الممتاز ${refMargin.toFixed(1)}%`;
      w1.actions.push(`✅ راجع تكاليف الشهر الجديد (مرتبات، كيماويات، إيجار)`);
      w1.actions.push(`💎 اختر 2-3 تحاليل من الفرص النايمة واعملهم عروض`);
      w1.success = `الهامش ≥ ${(refMargin - 2).toFixed(0)}%`;
    }
    weeks.push(w1);
    const w2 = { icon: '🚀', title: 'دفع النمو', badge: 'نمو', goal: '', actions: [], success: '' };
    if (weakerGrowth < -5) {
      w2.goal = `تعويض الانخفاض وزيادة الإيراد الأسبوعي 8%`;
      w2.actions.push(`🏥 حملة على فرع ${weakerBranch} (نمو ${weakerGrowth.toFixed(1)}% — الأضعف)`);
      if (topSellers.length >= 2) w2.actions.push(`🏆 باقة "${topSellers[0].name}" + "${topSellers[1].name}" بسعر محفّز`);
      w2.success = `نمو إيراد الأسبوع ≥ 5%`;
    } else {
      w2.goal = `استغلال الزخم — نمو إيراد 10%`;
      if (topSellers.length >= 3) w2.actions.push(`📣 حملة على: ${topSellers.slice(0,3).map(t => t.name).join(' • ')}`);
      if (sleepingTests.length > 0) w2.actions.push(`💎 فعّل "${sleepingTests[0].name}" (ربح صافي ${sleepingTests[0].trueProfitUnit} ج، لكن اتباع ${sleepingTests[0].count} مرة)`);
      w2.success = `إيراد الأسبوع ≥ ${(refRev * 1.10).toLocaleString()} ج`;
    }
    weeks.push(w2);
    const w3 = { icon: '⚙️', title: 'كفاءة وتوفير', badge: 'كفاءة', goal: '', actions: [], success: '' };
    if (refExpRatio > 60) {
      w3.goal = `خفض نسبة المصاريف من ${refExpRatio.toFixed(1)}% لـ 55%`;
      w3.actions.push(`💰 راجع فاتورة الكيماويات — إجمالي المصاريف ${refExp.toLocaleString()} ج`);
      w3.actions.push(`🏥 قارن مصاريف المعمل الخارجي بين الفرعين`);
      w3.actions.push(`✂️ أوقف شراء أي بند غير ضروري`);
      w3.success = `نسبة المصاريف ≤ 58%`;
    } else {
      w3.goal = `رفع متوسط الفاتورة من ${Math.round(avgInvoice)} ج لـ ${targetAvg} ج`;
      w3.actions.push(`💼 اعمل 2-3 باقات تحاليل بسعر مجمّع أقل 10%`);
      w3.actions.push(`💡 درّب الاستقبال على اقتراح تحليل إضافي لكل حالة`);
      w3.success = `متوسط الفاتورة ≥ ${targetAvg} ج`;
    }
    weeks.push(w3);
    const w4 = { icon: '📊', title: 'مراجعة وتحضير', badge: 'مراجعة', goal: 'تقييم الشهر وتجهيز خطة الشهر الجاي', actions: [`📊 قارن نتائج الشهر بالخطة`, `🏥 راجع أداء كل فرع + قرارات التحاليل`, `🎯 حدد 3 أهداف رئيسية للشهر الجاي`, `💰 راجع ميزانية الشهر الجاي قبل بدايته`], success: `تقرير مراجعة + 3 أهداف محددة` };
    weeks.push(w4);
    return weeks;
  }

  function buildTaskList(ctx) {
    const tasks = [];
    const { refMargin, refExp, refExpRatio, refProfit, losingTests, sleepingTests, topSellers, topProfitable, jRevGrowth, bRevGrowth, avgInvoice } = ctx;
    if (refMargin < 30) tasks.push({ priority: 'high', priorityAr: 'عالية', tag: 'financial', tagAr: 'مالي', title: `ارفع هامش الربح فوق 30%`, reason: `الهامش الحالي ${refMargin.toFixed(1)}% — أقل من الحد الآمن. راجع أعلى 3 بنود مصاريف (${refExp.toLocaleString()} ج).` });
    else if (refMargin < 40) tasks.push({ priority: 'medium', priorityAr: 'متوسطة', tag: 'financial', tagAr: 'مالي', title: `حسّن الهامش لـ 40%`, reason: `الهامش ${refMargin.toFixed(1)}% — كويس لكن ممكن يتحسن.` });
    if (refExpRatio > 60) tasks.push({ priority: 'high', priorityAr: 'عالية', tag: 'financial', tagAr: 'مالي', title: `قلل نسبة المصاريف/الإيراد`, reason: `النسبة ${refExpRatio.toFixed(1)}% — الهدف 55% أو أقل. خفض 5% = توفير ${(refExp * 0.05).toLocaleString()} ج.` });
    if (jRevGrowth < -10) tasks.push({ priority: 'high', priorityAr: 'عالية', tag: 'branch', tagAr: 'فرع', title: `أنعش فرع الجعافرة`, reason: `إيراد الجعافرة نزل ${Math.abs(jRevGrowth).toFixed(1)}% عن الشهر السابق.` });
    if (bRevGrowth < -10) tasks.push({ priority: 'high', priorityAr: 'عالية', tag: 'branch', tagAr: 'فرع', title: `أنعش فرع بهتيم`, reason: `إيراد بهتيم نزل ${Math.abs(bRevGrowth).toFixed(1)}% عن الشهر السابق.` });
    losingTests.slice(0, 3).forEach(t => {
      tasks.push({ priority: 'high', priorityAr: 'عالية', tag: 'tests', tagAr: 'تحاليل', title: `ارفع سعر "${t.name}" أو أوقفه`, reason: `خسارة صافية ${Math.abs(t.trueProfitUnit)} ج/تحليل (سعر ${t.sell} ج، تكلفة حقيقية ${t.trueCost.toFixed(1)} ج). اتباع ${t.count} مرة — إجمالي خسارة ${Math.abs(t.trueTotalProfit).toLocaleString()} ج.` });
    });
    if (topSellers.length >= 2) tasks.push({ priority: 'medium', priorityAr: 'متوسطة', tag: 'operational', tagAr: 'تشغيلي', title: `باقة "${topSellers[0].name}" + "${topSellers[1].name}"`, reason: `الأكثر مبيعاً: ${topSellers[0].count}× و${topSellers[1].count}×. الباقة تزود متوسط الفاتورة 15-20%.` });
    if (sleepingTests.length > 0) tasks.push({ priority: 'medium', priorityAr: 'متوسطة', tag: 'tests', tagAr: 'تحاليل', title: `فعّل "${sleepingTests[0].name}"`, reason: `ربح صافي ${sleepingTests[0].trueProfitUnit} ج/تحليل لكن اتباع ${sleepingTests[0].count} مرة بس.` });
    if (avgInvoice < 250) tasks.push({ priority: 'medium', priorityAr: 'متوسطة', tag: 'operational', tagAr: 'تشغيلي', title: `ارفع متوسط الفاتورة`, reason: `متوسط الفاتورة ${Math.round(avgInvoice)} ج — أقل من المثالي (250-300 ج).` });
    if (refProfit > 0) tasks.push({ priority: 'medium', priorityAr: 'متوسطة', tag: 'financial', tagAr: 'مالي', title: `راجع عقود الموردين`, reason: `خفض 5% من المصاريف = توفير ${(refExp * 0.05).toLocaleString()} ج — يزود صافي الربح ${((refExp * 0.05) / refProfit * 100).toFixed(1)}%.` });
    if (topProfitable.length > 0) { const t = topProfitable[0]; tasks.push({ priority: 'low', priorityAr: 'منخفضة', tag: 'tests', tagAr: 'تحاليل', title: `ركّز تسويق على "${t.name}"`, reason: `أعلى ربح صافي إجمالي (${t.trueTotalProfit.toLocaleString()} ج). كل 10 حالات زيادة = ${(t.trueProfitUnit * 10).toLocaleString()} ج إضافي.` }); }
    return tasks.slice(0, 10);
  }

  function buildStrategy(ctx, monthName) {
    const { refMargin, refJMargin, refBMargin, topSellers, losingTests, sleepingTests, refRev } = ctx;
    const points = [];
    if (refMargin >= 50) points.push(`✅ حافظ على الهامش الممتاز (${refMargin.toFixed(0)}%+) — ركّز على النمو مش التوفير.`);
    else if (refMargin >= 35) points.push(`📊 هدفك: رفع الهامش لـ ${(refMargin + 5).toFixed(0)}% — راجع المصاريف الثابتة.`);
    else points.push(`🚨 الهامش ${refMargin.toFixed(1)}% — خطة إصلاح عاجلة.`);
    const weaker = refJMargin < refBMargin ? 'الجعافرة' : 'بهتيم';
    const stronger = refJMargin > refBMargin ? 'الجعافرة' : 'بهتيم';
    points.push(`🏥 ركّز على ${weaker} (الأضعف) + استغل قوة ${stronger} بباقات جديدة.`);
    if (topSellers.length >= 3) { const top3Sum = topSellers.slice(0,3).reduce((a, t) => a + t.count, 0); points.push(`🔬 وسّع باقات ${topSellers.slice(0,3).map(t => t.name).join(' + ')} — مجموع تكرارهم ${top3Sum}×.`); }
    if (losingTests.length > 0) points.push(`💸 هدف: صفر تحاليل خاسرة — عندك ${losingTests.length} تحليل محتاج إصلاح.`);
    if (sleepingTests.length > 0) points.push(`💎 نشّط ${sleepingTests.length} تحليل "نايم" بربح عالي — فرصة نمو 15-20%.`);
    const targetRev = Math.round(refRev * 1.12);
    points.push(`📈 مستهدف ${monthName}: نمو إيراد 10-15% (${targetRev.toLocaleString()} ج).`);
    return points;
  }    // ==== تشغيل خطة الشهر ====
  window.renderMonthlyPlan = function() {
    const container = document.getElementById('planContent');
    const subtitle = document.getElementById('planSubtitle');
    if (!container) return;
    if (!salesWorkbook) {
      container.innerHTML = `<div class="advisor-card"><div class="advisor-card-body">⚠️ ارفع ملف المتابعة السنوية أولاً عشان الخطة تظهر.</div></div>`;
      if (subtitle) subtitle.textContent = '⚠️ في انتظار رفع البيانات';
      return;
    }
    const ref = findLatestReportMonth();
    if (!ref) {
      container.innerHTML = `<div class="advisor-card"><div class="advisor-card-body">ℹ️ مفيش بيانات شهرية كافية لعرض الخطة.</div></div>`;
      if (subtitle) subtitle.textContent = '⚠️ لا توجد بيانات كافية';
      return;
    }

    const monthsAr = ['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
    let planM = ref.month + 1, planY = ref.year;
    if (planM > 12) { planM = 1; planY++; }
    const planMonthName = monthsAr[planM - 1];
    
    const refJ = extractMonthData(ref.year, ref.month, 'الجعافرة');
    const refB = extractMonthData(ref.year, ref.month, 'بهتيم');
    const refRev = refJ.rev + refB.rev;
    const refExp = refJ.exp + refB.exp;
    const refProfit = refRev - refExp;
    const refCases = refJ.cases + refB.cases;
    const refMargin = refRev > 0 ? (refProfit / refRev * 100) : 0;
    const refExpRatio = refRev > 0 ? (refExp / refRev * 100) : 0;
    const avgInvoice = refCases > 0 ? (refRev / refCases) : 0;

    let prevM = ref.month - 1, prevY = ref.year;
    if (prevM < 1) { prevM = 12; prevY--; }
    const pJ = extractMonthData(prevY, prevM, 'الجعافرة');
    const pB = extractMonthData(prevY, prevM, 'بهتيم');
    const prevRev = pJ.rev + pB.rev;

    const histY1 = planY - 1; // 2025
    const histY2 = planY - 2; // 2024
    const h1J = extractMonthData(histY1, planM, 'الجعافرة');
    const h1B = extractMonthData(histY1, planM, 'بهتيم');
    const h1Rev = h1J.rev + h1B.rev, h1Exp = h1J.exp + h1B.exp, h1Cases = h1J.cases + h1B.cases;
    
    const h2J = extractMonthData(histY2, planM, 'الجعافرة');
    const h2B = extractMonthData(histY2, planM, 'بهتيم');
    const h2Rev = h2J.rev + h2B.rev, h2Exp = h2J.exp + h2B.exp, h2Cases = h2J.cases + h2B.cases;

    const merged = getMergedData('combined', 'latest');
    const topSellers = [...merged].sort((a,b) => b.count - a.count).slice(0, 5);
    const topProfitable = [...merged].sort((a,b) => b.trueTotalProfit - a.trueTotalProfit).slice(0, 5);
    const losingTests = merged.filter(t => t.trueCost > t.sell && t.count > 0).sort((a,b) => a.trueProfitUnit - b.trueProfitUnit);
    const medProfit = calcMedian(merged.map(t => t.trueProfitUnit));
    const sleepingTests = merged.filter(t => t.count <= 2 && t.trueProfitUnit > medProfit && t.sell > 0).sort((a,b) => b.trueProfitUnit - a.trueProfitUnit);

    const refJMargin = refJ.rev > 0 ? ((refJ.rev - refJ.exp) / refJ.rev * 100) : 0;
    const refBMargin = refB.rev > 0 ? ((refB.rev - refB.exp) / refB.rev * 100) : 0;
    const jRevGrowth = pJ.rev > 0 ? ((refJ.rev - pJ.rev) / pJ.rev * 100) : 0;
    const bRevGrowth = pB.rev > 0 ? ((refB.rev - pB.rev) / pB.rev * 100) : 0;

    const ctx = { refMonthName: monthsAr[ref.month - 1], refRev, refExp, refProfit, refCases, refMargin, refExpRatio, avgInvoice, refJ, refB, refJMargin, refBMargin, jRevGrowth, bRevGrowth, topSellers, topProfitable, losingTests, sleepingTests, merged };

    if (subtitle) subtitle.textContent = `جاري تحليل البيانات وبناء خطة ${planMonthName} ${planY}`;

    const summaryHtml = `<div class="plan-summary-banner"><div class="plan-summary-title">📊 نظرة عامة على الموسمية — ${planMonthName}</div><div class="plan-summary-subtitle">بناءً على بيانات ${planMonthName} ${histY2} و ${planMonthName} ${histY1}.</div></div><div class="plan-kpi-grid"><div class="plan-kpi-card" style="border-color:#00ff7f;"><div class="plan-kpi-label">💰 إيراد ${planMonthName} ${histY1}</div><div class="plan-kpi-value" style="color:#00ff7f;">${h1Rev.toLocaleString()} ج</div></div><div class="plan-kpi-card" style="border-color:#00bfff;"><div class="plan-kpi-label">👥 حالات ${planMonthName} ${histY1}</div><div class="plan-kpi-value" style="color:#00bfff;">${h1Cases.toLocaleString()}</div></div><div class="plan-kpi-card" style="border-color:#fbbf24;"><div class="plan-kpi-label">📊 صافي ربح ${planMonthName} ${histY1}</div><div class="plan-kpi-value" style="color:#fbbf24;">${(h1Rev - h1Exp).toLocaleString()} ج</div></div></div>`;
    
    const offlinePlanHtml = (reason) => {
      const weeks = buildWeeklyPlan(ctx);
      const weeklyHtml = `<div class="cases-section-card"><h4>📅 خطة ${monthsAr[planM - 1]} ${planY} — 4 أسابيع تفصيلية</h4><div class="plan-weeks-grid">${weeks.map((w, i) => `<div class="plan-week-card"><div class="plan-week-header"><span class="plan-week-title">${w.icon} الأسبوع ${i+1}: ${w.title}</span><span class="plan-week-goal-badge">${w.badge}</span></div><div class="plan-week-goal"><strong>🎯 الهدف:</strong> ${w.goal}</div><div class="plan-week-actions-title">📋 الإجراءات:</div><ul class="plan-week-actions">${w.actions.map(a => `<li>${a}</li>`).join('')}</ul><div class="plan-week-metric"><strong>📈 مؤشر النجاح:</strong> ${w.success}</div></div>`).join('')}</div></div>`;
      
      const tasks = buildTaskList(ctx);
      const tasksHtml = `<div class="cases-section-card"><h4>✅ قائمة المهام التنفيذية (${tasks.length} مهمة)</h4><ul class="plan-tasks-list">${tasks.map(t => `<li class="plan-task-item"><div class="plan-task-priority ${t.priority}">${t.priorityAr}</div><div class="plan-task-body"><div class="plan-task-title">${t.title}<span class="plan-task-tag ${t.tag}">${t.tagAr}</span></div><div class="plan-task-reason">💡 ${t.reason}</div></div></li>`).join('')}</ul></div>`;
      
      const plan2 = addMonths(now.getFullYear(), now.getMonth() + 1, 2);
      const plan3 = addMonths(now.getFullYear(), now.getMonth() + 1, 3);
      const strategy2 = buildStrategy(ctx, monthsAr[plan2.month - 1]);
      const strategy3 = buildStrategy(ctx, monthsAr[plan3.month - 1]);
      const strategyHtml = `<div class="plan-strategy-grid"><div class="plan-strategy-card"><div class="plan-strategy-title">🎯 استراتيجية ${monthsAr[plan2.month - 1]} ${plan2.year}</div><ul class="plan-strategy-points">${strategy2.map(s => `<li>${s}</li>`).join('')}</ul></div><div class="plan-strategy-card"><div class="plan-strategy-title">🎯 استراتيجية ${monthsAr[plan3.month - 1]} ${plan3.year}</div><ul class="plan-strategy-points">${strategy3.map(s => `<li>${s}</li>`).join('')}</ul></div></div>`;
      
      return summaryHtml + `<div class="advisor-card" style="border-color: var(--warning); margin-top: 20px;"><div class="advisor-card-header" style="background: rgba(243, 156, 18, 0.1); padding: 15px; border-radius: 10px 10px 0 0;"><h4 style="color: var(--warning); margin: 0;">⚠️ خطة الطوارئ (بناءً على القوانين) - ${reason}</h4></div><div class="advisor-card-body" style="padding: 20px; color: var(--text-muted);">المستشار الذكي مش متاح حالياً، فالنظام جهزلك الخطة دي بناءً على قوانين تحليل البيانات الحقيقية اللي إحنا كاتبينها.</div></div>` + weeklyHtml + tasksHtml + strategyHtml;
    };

    const now = new Date();
    container.innerHTML = `<div style="text-align:center; padding: 40px;"><div class="loading-spinner" style="margin: 0 auto 20px; border-top-color: var(--primary-glow);"></div><p style="color:var(--primary-glow); font-weight:bold; font-size:1.1rem;">⏳ جاري استشارة المحلل الذكي...<br><span style="font-size:0.85rem; color:var(--text-muted); font-weight:normal;">بناءً على أرقام الموسمية الحقيقية.</span></p></div>`;

    let prompt = `أنت الآن "مستشار مالي وتشغيلي واستراتيجي" خبير في إدارة المعامل الطبية. أنا الدكتور أحمد طه، صاحب "${TEBA_CONFIG.lab.name}".\n`;
    prompt += `أحتاج منك خطة عمل تنفيذية شاملة لشهر **${planMonthName} ${planY}**.\n\n`;
    prompt += `📊 **[1] بيانات الموسمية (شهر ${planMonthName} في السنين السابقة):**\n`;
    prompt += `- ${planMonthName} ${histY2}: إيراد ${h2Rev} ج، حالات ${h2Cases}، صافي ربح ${h2Rev - h2Exp} ج.\n`;
    prompt += `- ${planMonthName} ${histY1}: إيراد ${h1Rev} ج، حالات ${h1Cases}، صافي ربح ${h1Rev - h1Exp} ج.\n\n`;
    prompt += `📉 **[2] الوضع الحالي (آخر شهر مكتمل - ${monthsAr[ref.month - 1]} ${ref.year}):**\n`;
    prompt += `- الإيراد: ${refRev} ج، الحالات: ${refCases}، صافي الربح: ${refProfit} ج.\n`;
    prompt += `- أفضل التحاليل مبيعاً: ${topSellers.map(t => t.name).join('، ')}.\n`;
    if (losingTests.length > 0) prompt += `- تحاليل خاسرة محتاجة تعديل: ${losingTests.map(t => t.name).join('، ')}.\n\n`;
    prompt += `🏥 **[3] أداء الفروع:**\n- فرع الجعافرة: إيراد ${refJ.rev} ج، حالات ${refJ.cases}، هامش ربح ${refJMargin.toFixed(1)}%.\n- فرع بهتيم: إيراد ${refB.rev} ج، حالات ${refB.cases}، هامش ربح ${refBMargin.toFixed(1)}%.\n\n`;
    prompt += `\n🎯 **المطلوب منك كخبير:**\n1. **تحليل الموسمية:** هل ${planMonthName} بيبقى شهر زحمة ولا هادي؟\n2. **خطة فنية:** إيه التحاليل اللي نركز عليها؟\n3. **خطة إدارية:** إزاي نجهز الفريق؟\n4. **خطة مالية:** إزاي نحافظ على الربح؟\n5. **خطة أسبوعية:** 4 أسابيع تفصيلية.\n6. **خطة ربع سنوية:** لو لقيت فرع ضعيف، اعمل له خطة إنقاذ.\n`;
    prompt += `\n(اكتب الخطة باللغة العربية بأسلوب عملي ومباشر ومقسم لعناوين رئيسية بدون مقدمات).`;

    fetch('https://teba-ai.aabunada20.workers.dev/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt })
    }).then(res => res.json()).then(data => {
        if (data.error) throw new Error(data.error);
        let aiText = data.result;
        aiText = aiText.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--gold); font-size:1.1rem;">$1</strong>').replace(/\n/g, '<br>').replace(/- (.*?)(<br>|$)/g, '<li style="margin-right:20px; margin-bottom:8px;">$1</li>');
        
        const aiPlanHtml = `<div class="advisor-card" style="border-color: var(--primary-glow); margin-top: 20px;"><div class="advisor-card-header" style="background: rgba(77, 107, 254, 0.1); padding: 15px; border-radius: 10px 10px 0 0;"><h4 style="color: var(--primary-glow); margin: 0;">🤖 خطة ${planMonthName} ${planY} (المستشار الذكي)</h4></div><div class="advisor-card-body" style="padding: 20px; line-height: 1.8; font-size: 1rem; color: var(--text);">${aiText}</div></div>`;
        container.innerHTML = summaryHtml + aiPlanHtml;
        if (subtitle) subtitle.textContent = `خطة ${planMonthName} ${planY} مبنية على تحليل الموسمية`;
    }).catch(err => {
        container.innerHTML = offlinePlanHtml('رصيد الـ AI غير كافٍ أو السيرفر مشغول');
        if (subtitle) subtitle.textContent = `خطة ${planMonthName} ${planY} (خطة الطوارئ)`;
    });
  };

  // ==== نظرة عامة ====
  function renderOverview() {
    renderMonthlyAdvisor();
    let totalRevAll = 0, totalExpAll = 0, totalCasesAll = 0; let chartLabels = [], chartRevs = [], chartExps = []; let rev2025 = 0, rev2026 = 0;
    ['2024', '2025', '2026'].forEach(year => {
      let combinedRev = 0, combinedExp = 0, combinedCases = 0;
      ['الجعافرة', 'بهتيم'].forEach(branch => { let r = extractYearData(year, branch); combinedRev += r.rev; combinedExp += r.exp; let m = extractMonthData(year, 'all', branch); combinedCases += m.cases; });
      totalRevAll += combinedRev; totalExpAll += combinedExp; totalCasesAll += combinedCases;
      chartLabels.push(year); chartRevs.push(combinedRev); chartExps.push(combinedExp);
      if (year === '2025') rev2025 = combinedRev; if (year === '2026') rev2026 = combinedRev;
    });
    const ovRev = document.getElementById('ov-revenue'); const ovExp = document.getElementById('ov-expenses'); const ovProf = document.getElementById('ov-profit'); const ovCases = document.getElementById('ov-cases');
    if (ovRev) ovRev.textContent = totalRevAll.toLocaleString('en-US') + ' ج';
    if (ovExp) ovExp.textContent = totalExpAll.toLocaleString('en-US') + ' ج';
    if (ovProf) ovProf.textContent = (totalRevAll - totalExpAll).toLocaleString('en-US') + ' ج';
    if (ovCases) ovCases.textContent = totalCasesAll.toLocaleString('en-US');
    const alertBox = document.getElementById('overviewAlert');
    if (alertBox) {
      let alertMsg = '';
      if (rev2026 > 0 && rev2025 > 0) { const growth = ((rev2026 - rev2025) / rev2025) * 100; if (growth > 0) alertMsg = `📈 ممتاز! إيرادات 2026 أعلى من 2025 بنسبة نمو ${growth.toFixed(1)}%.`; else alertMsg = `⚠️ تنبيه: إيرادات 2026 أقل من 2025 بنسبة انكماش ${Math.abs(growth).toFixed(1)}%.`; }
      else if (rev2026 > 0) alertMsg = `📊 إجمالي إيراد 2026 حتى الآن: ${rev2026.toLocaleString()} ج.`;
      else alertMsg = `ℹ️ يرجى رفع ملفات إكسيل تحتوي على بيانات لسنوات متعددة.`;
      alertBox.textContent = alertMsg; alertBox.style.display = 'block';
    }
    const canvas = document.getElementById('overviewChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window.ovChart) window.ovChart.destroy();
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#334155' : '#fff';
    const gridColor = isLight ? '#e2e8f0' : '#a8b5a8';
    window.ovChart = new Chart(ctx, { type: 'bar', data: { labels: chartLabels, datasets: [ { label: 'الإيرادات', data: chartRevs, backgroundColor: 'rgba(22, 163, 74, 0.7)' }, { label: 'المصروفات', data: chartExps, backgroundColor: 'rgba(220, 38, 38, 0.7)' } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } } }, scales: { y: { ticks: { color: gridColor } }, x: { ticks: { color: gridColor } } } } });
  }

  window.renderFinancialReport = function() {
    const selectedYear = document.getElementById('yearSelector').value; const selectedMonth = document.getElementById('monthSelector').value; const selectedBranch = document.getElementById('branchSelector').value;
    let totalRev = 0, totalExp = 0;
    let branchesToProcess = selectedBranch === 'combined' ? ['الجعافرة', 'بهتيم'] : [selectedBranch === 'jaafara' ? 'الجعافرة' : 'بهتيم'];
    branchesToProcess.forEach(b => { let res = extractMonthData(selectedYear, selectedMonth, b); totalRev += res.rev; totalExp += res.exp; });
    
    document.getElementById('fin-revenue').textContent = totalRev.toLocaleString('en-US') + ' ج';
    document.getElementById('fin-expenses').textContent = totalExp.toLocaleString('en-US') + ' ج';
    document.getElementById('fin-profit').textContent = (totalRev - totalExp).toLocaleString('en-US') + ' ج';
    
    document.getElementById('ex-fin-revenue').textContent = totalRev.toLocaleString('en-US') + ' ج';
    document.getElementById('ex-fin-expenses').textContent = totalExp.toLocaleString('en-US') + ' ج';
    document.getElementById('ex-fin-profit').textContent = (totalRev - totalExp).toLocaleString('en-US') + ' ج';

    const canvas = document.getElementById('financeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window.finChart) window.finChart.destroy();
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#334155' : '#fff';
    const gridColor = isLight ? '#e2e8f0' : '#a8b5a8';
    window.finChart = new Chart(ctx, { type: 'bar', data: { labels: ['الإيرادات', 'المصروفات', 'صافي الربح'], datasets: [{ data: [totalRev, totalExp, (totalRev - totalExp)], backgroundColor: ['rgba(22, 163, 74, 0.7)', 'rgba(220, 38, 38, 0.7)', 'rgba(217, 119, 6, 0.7)'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: gridColor } }, x: { ticks: { color: gridColor } } } } });
  };  

  window.renderAnnualReport = function() {
    const selectedYear = document.getElementById('annualYearSelector').value; const selectedBranch = document.getElementById('annualBranchSelector').value;
    let finalRev = 0, finalExp = 0;
    let branchesToProcess = selectedBranch === 'combined' ? ['الجعافرة', 'بهتيم'] : [selectedBranch === 'jaafara' ? 'الجعافرة' : 'بهتيم'];
    branchesToProcess.forEach(b => { let res = extractYearData(selectedYear, b); finalRev += res.rev; finalExp += res.exp; });
    document.getElementById('annualTableBody').innerHTML = `<tr><td style="color:var(--gold);">${selectedYear}</td><td style="color:#16a34a;">${finalRev.toLocaleString()} ج</td><td style="color:#dc2626;">${finalExp.toLocaleString()} ج</td><td style="color:#d97706;">${(finalRev - finalExp).toLocaleString()} ج</td></tr>`;
    
    let labels = ['2024', '2025', '2026'], revs = [], exps = [], profits = [];
    labels.forEach(yr => { let yRev = 0, yExp = 0; branchesToProcess.forEach(b => { let r = extractYearData(yr, b); yRev += r.rev; yExp += r.exp; }); revs.push(yRev); exps.push(yExp); profits.push(yRev - yExp); });
    
    const revCanvas = document.getElementById('annualRevChart'); if (!revCanvas) return;
    const revCtx = revCanvas.getContext('2d');
    if (window.anRevChart) window.anRevChart.destroy();
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#334155' : '#fff';
    const gridColor = isLight ? '#e2e8f0' : '#a8b5a8';
    
    window.anRevChart = new Chart(revCtx, { type: 'bar', data: { labels: labels, datasets: [ { label: 'الإيرادات', data: revs, backgroundColor: 'rgba(22, 163, 74, 0.7)' }, { label: 'المصروفات', data: exps, backgroundColor: 'rgba(220, 38, 38, 0.7)' } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } } }, scales: { y: { ticks: { color: gridColor } }, x: { ticks: { color: gridColor } } } } });
    const profCanvas = document.getElementById('annualProfitChart'); if (!profCanvas) return;
    const profCtx = profCanvas.getContext('2d');
    if (window.anProfChart) window.anProfChart.destroy();
    window.anProfChart = new Chart(profCtx, { type: 'line', data: { labels: labels, datasets: [{ label: 'صافي الربح', data: profits, backgroundColor: 'rgba(217, 119, 6, 0.5)', borderColor: '#d97706', borderWidth: 3, fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } } }, scales: { y: { ticks: { color: gridColor } }, x: { ticks: { color: gridColor } } } } });
  };  

  window.renderCaseAnalysis = function() {
    const selectedYear = document.getElementById('casesYearSelector').value;
    const selectedBranch = document.getElementById('casesBranchSelector').value;
    const months = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
    const branchesToProcess = selectedBranch === 'combined' ? ['الجعافرة', 'بهتيم'] : [selectedBranch === 'jaafara' ? 'الجعافرة' : 'بهتيم'];
    const branchLabel = selectedBranch === 'combined' ? 'إجمالي الفرعين' : (selectedBranch === 'jaafara' ? 'الجعافرة' : 'بهتيم');
    const monthlyByYear = {};
    [2024, 2025, 2026].forEach(year => { monthlyByYear[year] = []; for (let m = 1; m <= 12; m++) { let total = 0; branchesToProcess.forEach(b => { total += extractMonthData(year, m, b).cases; }); monthlyByYear[year].push(total); } });
    const yearlyTotals = {}; [2024, 2025, 2026].forEach(year => { yearlyTotals[year] = monthlyByYear[year].reduce((a, b) => a + b, 0); });
    const avg2024_2025 = months.map((_, i) => { const a = monthlyByYear[2024][i]; const b = monthlyByYear[2025][i]; const count = [a, b].filter(x => x > 0).length; return count > 0 ? (a + b) / count : 0; });
    const sortedByAvg = avg2024_2025.map((v, i) => ({ month: months[i], avg: v })).filter(x => x.avg > 0).sort((a, b) => b.avg - a.avg);
    const kpiGrid = document.getElementById('casesKpiGrid');
    if (kpiGrid) {
      const yoy2025 = yearlyTotals[2024] > 0 ? ((yearlyTotals[2025] - yearlyTotals[2024]) / yearlyTotals[2024] * 100) : 0;
      const yoy2026 = yearlyTotals[2025] > 0 ? ((yearlyTotals[2026] - yearlyTotals[2025]) / yearlyTotals[2025] * 100) : 0;
      const activeMonths2026 = monthlyByYear[2026].filter(x => x > 0).length;
      const avgMonthly2026 = activeMonths2026 > 0 ? Math.round(yearlyTotals[2026] / activeMonths2026) : 0;
      kpiGrid.innerHTML = `<div class="cases-kpi-card" style="border-color:#94a3b8;"><h5>إجمالي حالات 2024</h5><div class="cases-kpi-value" style="color:#94a3b8;">${yearlyTotals[2024].toLocaleString()}</div><div class="cases-kpi-sub">حالة</div></div><div class="cases-kpi-card" style="border-color:#0284c7;"><h5>إجمالي حالات 2025</h5><div class="cases-kpi-value" style="color:#0284c7;">${yearlyTotals[2025].toLocaleString()}</div><div class="cases-kpi-sub" style="color:${yoy2025 >= 0 ? '#16a34a' : '#dc2626'};">${yoy2025 >= 0 ? '↑' : '↓'} ${Math.abs(yoy2025).toFixed(1)}% عن 2024</div></div><div class="cases-kpi-card" style="border-color:#d97706;"><h5>إجمالي حالات 2026</h5><div class="cases-kpi-value" style="color:#d97706;">${yearlyTotals[2026].toLocaleString()}</div><div class="cases-kpi-sub" style="color:${yoy2026 >= 0 ? '#16a34a' : '#dc2626'};">${yoy2026 >= 0 ? '↑' : '↓'} ${Math.abs(yoy2026).toFixed(1)}% عن 2025</div></div><div class="cases-kpi-card" style="border-color:#a78bfa;"><h5>متوسط شهري (2026)</h5><div class="cases-kpi-value" style="color:#a78bfa;">${avgMonthly2026.toLocaleString()}</div><div class="cases-kpi-sub">حالة/شهر (خلال ${activeMonths2026} شهر)</div></div>`;
    }
    const branchCards = document.getElementById('casesBranchCards');
    if (branchCards) {
      let branchHtml = '';
      ['الجعافرة', 'بهتيم'].forEach(branch => {
        const byYear = { 2024: 0, 2025: 0, 2026: 0 };
        [2024, 2025, 2026].forEach(year => { let total = 0; for (let m = 1; m <= 12; m++) { total += extractMonthData(year, m, branch).cases; } byYear[year] = total; });
        const g2025 = byYear[2024] > 0 ? ((byYear[2025] - byYear[2024]) / byYear[2024] * 100) : 0;
        const g2026 = byYear[2025] > 0 ? ((byYear[2026] - byYear[2025]) / byYear[2025] * 100) : 0;
        branchHtml += `<div class="branch-card"><h4>🏥 فرع ${branch}</h4><table class="branch-table"><tr><td>2024</td><td style="color:#94a3b8;">${byYear[2024].toLocaleString()}</td><td style="color:#94a3b8;">—</td></tr><tr><td>2025</td><td style="color:#0284c7;">${byYear[2025].toLocaleString()}</td><td style="color:${g2025 >= 0 ? '#16a34a' : '#dc2626'}; font-weight:bold;">${g2025 >= 0 ? '↑' : '↓'} ${Math.abs(g2025).toFixed(1)}%</td></tr><tr><td>2026</td><td style="color:#d97706;">${byYear[2026].toLocaleString()}</td><td style="color:${g2026 >= 0 ? '#16a34a' : '#dc2626'}; font-weight:bold;">${g2026 >= 0 ? '↑' : '↓'} ${Math.abs(g2026).toFixed(1)}%</td></tr></table></div>`;
      });
      branchCards.innerHTML = branchHtml;
    }
    const alertBox = document.getElementById('casesAlert');
    if (alertBox) {
      const alerts = [];
      if (sortedByAvg.length > 0) {
        const top3 = sortedByAvg.slice(0, 3); const bottom3 = sortedByAvg.slice(-3).reverse();
        alerts.push(`📈 <strong>أكثر 3 شهور زحمة:</strong> ${top3.map(t => `${t.month} (${Math.round(t.avg)} حالة)`).join(' • ')}`);
        alerts.push(`📉 <strong>أكثر 3 شهور هدوء:</strong> ${bottom3.map(t => `${t.month} (${Math.round(t.avg)} حالة)`).join(' • ')}`);
        const maxAvg = top3[0].avg; const minAvg = bottom3[bottom3.length - 1].avg;
        const variation = maxAvg > 0 ? ((maxAvg - minAvg) / maxAvg * 100) : 0;
        if (variation > 40) alerts.push(`✅ <strong>الموسمية شغالة:</strong> الفرق ${variation.toFixed(0)}% — شهور محددة زحمة.`);
        else if (variation > 20) alerts.push(`🌤️ <strong>الموسمية متوسطة:</strong> الفرق ${variation.toFixed(0)}%.`);
        else alerts.push(`⚠️ <strong>الموسمية ضعيفة:</strong> الفرق ${variation.toFixed(0)}%.`);
      }
      alertBox.innerHTML = alerts.map(a => `<div style="margin-bottom:10px;">${a}</div>`).join('');
      alertBox.style.display = 'block';
    }
    const chartTitle = document.getElementById('casesChartTitle');
    if (chartTitle) chartTitle.textContent = `(${selectedYear} - ${branchLabel})`;
    const casesCanvas = document.getElementById('casesChart');
    if (casesCanvas) {
      const ctx = casesCanvas.getContext('2d');
      if (window.casesChartInst) window.casesChartInst.destroy();
      const isLight = document.body.classList.contains('light-mode');
      const textColor = isLight ? '#334155' : '#fff';
      const gridColor = isLight ? '#e2e8f0' : '#a8b5a8';
      
      window.casesChartInst = new Chart(ctx, {
        type: 'bar',
        data: { labels: months, datasets: [ { label: `بيانات ${selectedYear}`, data: monthlyByYear[parseInt(selectedYear)], backgroundColor: 'rgba(2, 132, 199, 0.7)', borderColor: '#0284c7', borderWidth: 2, borderRadius: 8, order: 2 }, { label: 'متوسط 2024+2025', data: avg2024_2025, type: 'line', borderColor: '#d97706', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], pointBackgroundColor: '#d97706', pointRadius: 4, fill: false, order: 1 } ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } } }, scales: { y: { ticks: { color: gridColor } }, x: { ticks: { color: gridColor } } } }
      });
    }
    const tbody = document.getElementById('casesMonthlyTableBody');
    if (tbody) {
      let html = '';
      months.forEach((month, i) => {
        const v2024 = monthlyByYear[2024][i]; const v2025 = monthlyByYear[2025][i]; const v2026 = monthlyByYear[2026][i];
        let changeStr = '—'; let changeColor = '#94a3b8';
        if (v2025 > 0 && v2026 > 0) { const change = ((v2026 - v2025) / v2025 * 100); changeStr = `${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}%`; changeColor = change >= 0 ? '#16a34a' : '#dc2626'; }
        html += `<tr><td style="color:var(--text); font-weight:bold;">${month}</td><td style="color:#94a3b8;">${v2024 || '—'}</td><td style="color:#0284c7;">${v2025 || '—'}</td><td style="color:#d97706;">${v2026 || '—'}</td><td style="color:${changeColor}; font-weight:bold;">${changeStr}</td></tr>`;
      });
      html += `<tr style="background:rgba(22,163,74,0.1); font-weight:bold;"><td style="color:var(--primary-glow);">الإجمالي</td><td style="color:#94a3b8;">${yearlyTotals[2024].toLocaleString()}</td><td style="color:#0284c7;">${yearlyTotals[2025].toLocaleString()}</td><td style="color:#d97706;">${yearlyTotals[2026].toLocaleString()}</td><td style="color:var(--primary-glow);">—</td></tr>`;
      tbody.innerHTML = html;
    }
    const seasonTbody = document.getElementById('seasonalityTableBody');
    const seasonAlert = document.getElementById('seasonalityAlert');
    const seasonHeader = document.getElementById('seasonalitySelectedYearHeader');
    if (seasonHeader) seasonHeader.textContent = selectedYear;
    if (seasonTbody) {
      const validAvgs = avg2024_2025.filter(x => x > 0);
      const sortedVals = [...validAvgs].sort((a, b) => a - b);
      const p33 = sortedVals[Math.floor(sortedVals.length * 0.33)] || 0;
      const p66 = sortedVals[Math.floor(sortedVals.length * 0.66)] || 0;
      let html = '';
      months.forEach((month, i) => {
        const avg = avg2024_2025[i]; const selectedYearValue = monthlyByYear[parseInt(selectedYear)][i];
        const diff = avg > 0 && selectedYearValue > 0 ? ((selectedYearValue - avg) / avg * 100) : 0;
        let classification = '—'; let classColor = '#94a3b8';
        if (avg > 0) { if (avg >= p66) { classification = '🔥 زحمة'; classColor = '#dc2626'; } else if (avg <= p33) { classification = '❄️ هادي'; classColor = '#0284c7'; } else { classification = '🌤️ متوسط'; classColor = '#d97706'; } }
        html += `<tr><td style="color:var(--text); font-weight:bold;">${month}</td><td style="color:#a78bfa;">${Math.round(avg) || '—'}</td><td style="color:#d97706;">${selectedYearValue || '—'}</td><td style="color:${diff >= 0 ? '#16a34a' : '#dc2626'}; font-weight:bold;">${avg > 0 && selectedYearValue > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : '—'}</td><td style="color:${classColor}; font-weight:bold;">${classification}</td></tr>`;
      });
      seasonTbody.innerHTML = html;
      if (seasonAlert && sortedByAvg.length > 0) {
        seasonAlert.innerHTML = `📊 <strong>الخلاصة:</strong> أعلى الشهور زحمة: (${sortedByAvg.slice(0, 3).map(t => t.month).join('، ')}) — جهّز الفريق. أقل الشهور: (${sortedByAvg.slice(-3).reverse().map(t => t.month).join('، ')}) — اعمل عروض.`;
        seasonAlert.style.display = 'block';
      }
    }
    const forecastCard = document.getElementById('forecastCard');
    if (forecastCard) {
      let latestMonthWithData = 0;
      for (let i = 11; i >= 0; i--) { if (monthlyByYear[2026][i] > 0) { latestMonthWithData = i + 1; break; } }
      if (latestMonthWithData > 0 && latestMonthWithData < 12) {
        const nextMonthIndex = latestMonthWithData; const nextMonthName = months[nextMonthIndex];
        const historicalAvg = avg2024_2025[nextMonthIndex];
        const overallAvg = avg2024_2025.reduce((a, b) => a + b, 0) / avg2024_2025.filter(x => x > 0).length;
        if (historicalAvg > 0) {
          forecastCard.innerHTML = `<h4 style="color:var(--primary-glow); margin-bottom:12px;">🔮 توقع ${nextMonthName} 2026</h4><p style="font-size:0.95rem; line-height:1.8; margin-bottom:12px;">بناءً على بيانات ${nextMonthName} في 2024 (<strong>${monthlyByYear[2024][nextMonthIndex]}</strong>) و 2025 (<strong>${monthlyByYear[2025][nextMonthIndex]}</strong>):</p><div style="background:rgba(22,163,74,0.1); padding:15px; border-radius:10px; margin:15px 0; text-align:center;"><div style="font-size:0.9rem; color:var(--text-muted); margin-bottom:5px;">متوسط ${nextMonthName} تاريخياً</div><div style="font-size:2rem; font-weight:bold; color:#d97706;">${Math.round(historicalAvg)} حالة</div></div><p style="font-size:0.9rem; color:var(--text-muted); line-height:1.8;"><strong style="color:var(--gold);">التوصية:</strong> جهّز الفريق لاستقبال حوالي <strong style="color:#16a34a;">${Math.round(historicalAvg)} حالة</strong> في ${nextMonthName} 2026. ${historicalAvg > overallAvg ? '⚠️ الشهر ده زحمة — زوّد الفريق.' : '💡 الشهر ده هادي — ركّز على العروض.'}</p>`;
        } else { forecastCard.innerHTML = `<p style="color:var(--text-muted);">ℹ️ مفيش بيانات تاريخية كافية لتوقع ${nextMonthName}.</p>`; }
      } else if (latestMonthWithData === 12) { forecastCard.innerHTML = `<p style="color:var(--text-muted);">ℹ️ السنة كاملة مسجلة.</p>`; }
      else { forecastCard.innerHTML = `<p style="color:var(--text-muted);">ℹ️ مفيش بيانات 2026 لتوقع الشهر القادم.</p>`; }
    }
  };

  function segmentTestsBCG(data) {
    if (!data || data.length === 0) return { stars: [], cashCows: [], questions: [], dogs: [], medCount: 0, medProfit: 0 };
    const medCount = calcMedian(data.map(t => t.count));
    const medProfit = calcMedian(data.map(t => t.trueProfitUnit));
    const stars = [], cashCows = [], questions = [], dogs = [];
    data.forEach(t => {
      const highSales = t.count >= medCount; const highProfit = t.trueProfitUnit >= medProfit;
      if (highSales && highProfit) stars.push(t);
      else if (highSales && !highProfit) cashCows.push(t);
      else if (!highSales && highProfit) questions.push(t);
      else dogs.push(t);
    });
    stars.sort((a,b) => b.trueTotalProfit - a.trueTotalProfit); cashCows.sort((a,b) => b.count - a.count);
    questions.sort((a,b) => b.trueProfitUnit - a.trueProfitUnit); dogs.sort((a,b) => a.trueTotalProfit - b.trueTotalProfit);
    return { stars, cashCows, questions, dogs, medCount, medProfit };
  }

  function fillBCGTable(tableId, data, color) {
    const tbody = document.getElementById(tableId); if (!tbody) return;
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد تحاليل في الفئة دي</td></tr>'; return; }
    let html = '';
    data.forEach((t, i) => { html += `<tr><td style="color:${color}; font-weight:bold;">${i+1}</td><td style="text-align:right; color:var(--text);">${t.name}</td><td style="color:#0284c7; font-weight:bold;">${t.count}</td><td style="color:#16a34a;">${t.sell} ج</td><td style="color:#dc2626;">${t.trueCost.toFixed(1)} ج</td><td style="color:${color}; font-weight:bold;">${t.trueProfitUnit.toFixed(1)} ج</td><td style="color:${color}; font-weight:bold;">${t.trueTotalProfit.toLocaleString()} ج</td></tr>`; });
    tbody.innerHTML = html;
  }

  function renderBCGUrgent(merged) {
    const card = document.getElementById('bcgUrgentCard'); if (!card) return;
    const losers = merged.filter(t => t.trueCost > t.sell && t.count > 0).sort((a,b) => (a.sell-a.trueCost) - (b.sell-b.trueCost));
    const medProfit = calcMedian(merged.map(t => t.trueProfitUnit));
    const opportunities = merged.filter(t => t.count <= 1 && t.trueProfitUnit > medProfit && t.sell > 0).sort((a,b) => b.trueProfitUnit - a.trueProfitUnit);
    let html = `<h4>🚨 قرارات عاجلة (بناءً على التكلفة الحقيقية)</h4>`;
    if (losers.length > 0) {
      html += `<div style="margin-bottom:15px;"><p style="color:#dc2626; font-weight:bold; margin-bottom:8px;">💸 تحاليل خاسرة (${losers.length}):</p><ul style="padding-right:20px; font-size:0.88rem; line-height:1.8;">`;
      losers.slice(0, 5).forEach(t => { html += `<li><strong>${t.name}</strong> — سعرها ${t.sell}ج، تكلفتها الحقيقية ${t.trueCost.toFixed(1)}ج (خسارة ${Math.abs(t.trueProfitUnit).toFixed(1)}ج/تحليل)</li>`; });
      html += `</ul></div>`;
    }
    if (opportunities.length > 0) {
      html += `<div style="margin-bottom:15px;"><p style="color:#d97706; font-weight:bold; margin-bottom:8px;">🎯 تحاليل نايمة (${opportunities.length}):</p><ul style="padding-right:20px; font-size:0.88rem; line-height:1.8;">`;
      opportunities.slice(0, 5).forEach(t => { html += `<li><strong>${t.name}</strong> — ربح صافي ${t.trueProfitUnit.toFixed(1)}ج/تحليل، اتباعت ${t.count} مرة بس</li>`; });
      html += `</ul></div>`;
    }
    if (losers.length === 0 && opportunities.length === 0) { html += `<p style="color:#16a34a; font-weight:bold;">✅ مفيش قرارات عاجلة.</p>`; }
    card.innerHTML = html;
  }

  window.renderBCGMatrix = function() {
    const summaryGrid = document.getElementById('bcgSummaryGrid');
    const alertBox = document.getElementById('bcgAlert');
    
    let monthFilterEl = document.getElementById('bcgMonthSel');
    if (!monthFilterEl && document.getElementById('bcgBranchSel')) {
        const branchSel = document.getElementById('bcgBranchSel');
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'bcgMonthSel';
        monthFilterEl.className = branchSel.className; 
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `
            <option value="latest">آخر شهر متاح</option>
            <option value="2026-10">أكتوبر 2026</option>
            <option value="2026-09">سبتمبر 2026</option>
            <option value="2025-10">أكتوبر 2025</option>
            <option value="2025-09">سبتمبر 2025</option>
        `;
        monthFilterEl.onchange = window.renderBCGMatrix; 
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    
    const branchFilter = document.getElementById('bcgBranchSel') ? document.getElementById('bcgBranchSel').value : 'combined';
    const monthFilter = monthFilterEl ? monthFilterEl.value : 'latest';
    
    const merged = getMergedData(branchFilter, monthFilter);
    
    if (!merged || merged.length === 0) {
      if (alertBox) { alertBox.innerHTML = '⚠️ لازم ترفع ملفي المبيعات والأسعار.'; alertBox.style.display = 'block'; }
      if (summaryGrid) summaryGrid.innerHTML = '';
      const urgentCard = document.getElementById('bcgUrgentCard'); if (urgentCard) urgentCard.innerHTML = '';
      ['Stars','CashCows','Questions','Dogs'].forEach(k => { const el = document.getElementById('bcg' + k + 'Table'); if (el) el.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">لا توجد بيانات</td></tr>'; });
      return;
    }
    const seg = segmentTestsBCG(merged);
    const cards = [
      { icon: '⭐', name: 'النجوم', count: seg.stars.length, color: '#16a34a', desc: 'مبيعتها عالية + ربحها الصافي عالي', action: 'ركز عليهم في التسويق', top: seg.stars.slice(0,3) },
      { icon: '🐄', name: 'الأحصنة', count: seg.cashCows.length, color: '#0284c7', desc: 'مبيعتها عالية + ربحها الصافي قليل', action: 'حسّن التكلفة', top: seg.cashCows.slice(0,3) },
      { icon: '❓', name: 'علامات استفهام', count: seg.questions.length, color: '#d97706', desc: 'مبيعتها قليلة + ربحها الصافي عالي', action: 'اعملهم عروض وباقات', top: seg.questions.slice(0,3) },
      { icon: '😴', name: 'نايم', count: seg.dogs.length, color: '#dc2626', desc: 'مبيعتها قليلة + ربحها الصافي قليل', action: 'فكر تشيلهم', top: seg.dogs.slice(0,3) }
    ];
    if (summaryGrid) {
      summaryGrid.innerHTML = cards.map(c => `
        <div class="bcg-summary-card" style="border-color:${c.color};">
          <div class="bcg-summary-header"><span class="bcg-icon">${c.icon}</span><span class="bcg-name" style="color:${c.color};">${c.name}</span></div>
          <div class="bcg-count" style="color:${c.color};">${c.count}</div>
          <div class="bcg-desc">${c.desc}</div>
          <div class="bcg-action" style="color:${c.color};">💡 ${c.action}</div>
          ${c.top.length > 0 ? `<div class="bcg-top">منهم: ${c.top.map(t => t.name).join(' • ')}</div>` : ''}
        </div>
      `).join('');
    }
    if (alertBox) { alertBox.innerHTML = `📊 <strong>تحليل ${merged.length} تحليل:</strong> الفاصل "مبيعات عالية" = <strong>${seg.medCount.toFixed(0)} مرة</strong>، "ربح صافي عالي" = <strong>${seg.medProfit.toFixed(1)} ج</strong>.`; alertBox.style.display = 'block'; }
    renderBCGUrgent(merged);
    fillBCGTable('bcgStarsTable', seg.stars, '#16a34a');
    fillBCGTable('bcgCashCowsTable', seg.cashCows, '#0284c7');
    fillBCGTable('bcgQuestionsTable', seg.questions, '#d97706');
    fillBCGTable('bcgDogsTable', seg.dogs, '#dc2626');
    
    const exportBody = document.getElementById('bcgExportBody');
    if (exportBody) {
      let exportHtml = '';
      const addRows = (arr, catName) => arr.forEach(t => { exportHtml += `<tr><td>${catName}</td><td>${t.name}</td><td>${t.count}</td><td>${t.sell}</td><td>${t.trueCost.toFixed(1)}</td><td>${t.trueProfitUnit.toFixed(1)}</td><td>${t.trueTotalProfit.toFixed(1)}</td></tr>`; });
      addRows(seg.stars, 'نجوم');
      addRows(seg.cashCows, 'أحصنة');
      addRows(seg.questions, 'علامات استفهام');
      addRows(seg.dogs, 'نايم'); 
      exportBody.innerHTML = exportHtml;
    }
  };

  function extractExpenseBreakdown(year, month, branch) {
    const cacheKey = `${year}|${month}|${branch}`;
    if (_expenseBreakdownCache.has(cacheKey)) return _expenseBreakdownCache.get(cacheKey);
    const wb = year === '2025' ? detailedWorkbook2025 : year === '2026' ? detailedWorkbook2026 : null;
    if (!wb) { _expenseBreakdownCache.set(cacheKey, null); return null; }
    const monthsAr = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
    const monthName = monthsAr[parseInt(month) - 1];
    let sheetName = null;
    for (const name of wb.SheetNames) { 
        const trimmed = name.trim(); 
        if (trimmed.includes(monthName) && trimmed.includes(String(year))) { sheetName = name; break; } 
        if (year === '2025' && month === '10' && trimmed.includes('اكتوبر') && trimmed.includes('205')) { sheetName = name; break; } 
    }
    if (!sheetName) { _expenseBreakdownCache.set(cacheKey, null); return null; }
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const branchKey = branch === 'الجعافرة' ? 'الجعافرة' : 'بهتيم';
    let branchStart = -1;
    for (let i = 0; i < data.length; i++) { if (data[i] && data[i][0] && String(data[i][0]).includes('معامل طيبة') && String(data[i][0]).includes(branchKey)) { branchStart = i; break; } }
    if (branchStart === -1) { _expenseBreakdownCache.set(cacheKey, null); return null; }
    let branchEnd = data.length;
    if (branch === 'الجعافرة') { for (let i = branchStart + 1; i < data.length; i++) { if (data[i] && data[i][0] && String(data[i][0]).includes('معامل طيبة') && String(data[i][0]).includes('بهتيم')) { branchEnd = i; break; } } }
    let fixedStart = -1;
    for (let i = branchStart; i < branchEnd; i++) { if (data[i] && data[i][0] && String(data[i][0]).trim() === 'بيان المصروفات الثابتة') { fixedStart = i; break; } }
    let chemicals = 0; let salaries = 0; const misc = {};
    if (fixedStart !== -1) {
      for (let i = fixedStart + 2; i < Math.min(fixedStart + 10, branchEnd); i++) {
        const row = data[i]; if (!row) break;
        const gStr = row[6] ? String(row[6]).trim() : ''; const iStr = row[8] ? String(row[8]).trim() : '';
        if (gStr === 'الاجمالي' || iStr === 'الاجمالي') break;
        const eVal = num(row[4]); if (eVal > 0) chemicals += eVal;
        const fVal = num(row[5]); if (fVal > 0 && gStr) { misc[gStr] = (misc[gStr] || 0) + fVal; }
        const hVal = num(row[7]); if (hVal > 0 && iStr) { salaries += hVal; }
      }
    } else {
      let specialStart = -1;
      for (let i = branchStart; i < branchEnd; i++) { if (data[i] && data[i][0] && String(data[i][0]).includes('المرتبات+الايجار')) { specialStart = i; break; } }
      if (specialStart === -1) { _expenseBreakdownCache.set(cacheKey, null); return null; }
      for (let i = specialStart + 1; i < Math.min(specialStart + 12, branchEnd); i++) {
        const row = data[i]; if (!row) break;
        const aLabel = row[0] ? String(row[0]).trim() : ''; const bVal = num(row[1]); const cVal = num(row[2]);
        if (aLabel === 'اجمالي مرتبات' || aLabel === 'اجمالي') break;
        if (cVal > 0) chemicals += cVal;
        if (bVal > 0 && aLabel) { if (aLabel.includes('ايجار') || aLabel.includes('إيجار')) misc['ايجار'] = (misc['ايجار'] || 0) + bVal; else if (aLabel.includes('كهربا')) misc['كهربا'] = (misc['كهربا'] || 0) + bVal; else if (aLabel.includes('مياة') || aLabel.includes('مياه')) misc['مياة'] = (misc['مياة'] || 0) + bVal; else if (aLabel.includes('د/') || aLabel.includes('ا/')) salaries += bVal; else misc[aLabel] = (misc[aLabel] || 0) + bVal; }
      }
    }
    const result = { chemicals, salaries, misc };
    _expenseBreakdownCache.set(cacheKey, result);
    return result;
  }  

  window.renderExpenseBreakdown = function() {
    const yearEl = document.getElementById('expenseYearSelector'); const monthEl = document.getElementById('expenseMonthSelector');
    if (!yearEl || !monthEl) return;
    const year = yearEl.value; const month = monthEl.value;
    const alertBox = document.getElementById('expenseAlert');
    if (alertBox) {
      if (!detailedWorkbook2025 && !detailedWorkbook2026) { alertBox.innerHTML = `⚠️ لازم ترفع ملفات التفصيل.`; alertBox.style.display = 'block'; }
      else if (year === '2025' && !detailedWorkbook2025) { alertBox.innerHTML = `⚠️ مفيش ملف تفصيل 2025.`; alertBox.style.display = 'block'; }
      else if (year === '2026' && !detailedWorkbook2026) { alertBox.innerHTML = `⚠️ مفيش ملف تفصيل 2026.`; alertBox.style.display = 'block'; }
      else { alertBox.style.display = 'none'; }
    }
    const branches = [{ name: 'الجعافرة', canvasId: 'expensePieJaafara', chartVar: 'expensePieJaafaraChart' }, { name: 'بهتيم', canvasId: 'expensePieBahtim', chartVar: 'expensePieBahtimChart' }];
    const tableData = {};
    const isLight = document.body.classList.contains('light-mode');
    const legendColor = isLight ? '#334155' : '#fff';
    
    branches.forEach(b => {
      const breakdown = extractExpenseBreakdown(year, month, b.name);
      const canvas = document.getElementById(b.canvasId); if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (window[b.chartVar]) window[b.chartVar].destroy();
      if (!breakdown) {
        window[b.chartVar] = new Chart(ctx, { type: 'doughnut', data: { labels: ['لا توجد بيانات'], datasets: [{ data: [1], backgroundColor: ['#475569'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: legendColor } } } } });
        tableData[b.name] = { cats: [], total: 0 }; return;
      }
      const cats = [];
      if (breakdown.salaries > 0) cats.push({ name: 'مرتبات', value: breakdown.salaries, color: '#22c55e' });
      if (breakdown.chemicals > 0) cats.push({ name: 'كيماويات', value: breakdown.chemicals, color: '#0284c7' });
      const miscColors = { 'ايجار': '#d97706', 'كهربا': '#dc2626', 'مياة': '#a78bfa', 'مياه': '#a78bfa', 'صيانة': '#f472b6', 'مطبوعات': '#fb923c' };
      if (breakdown.misc) { Object.keys(breakdown.misc).forEach(k => { if (breakdown.misc[k] > 0) { cats.push({ name: k, value: breakdown.misc[k], color: miscColors[k] || '#64748b' }); } }); }
      const monthly = extractMonthData(year, month, b.name);
      const fixedSum = cats.reduce((a,c) => a + c.value, 0);
      const daily = Math.max(0, monthly.exp - fixedSum);
      if (daily > 0) cats.push({ name: 'مصاريف يومية', value: daily, color: '#64748b' });
      tableData[b.name] = { cats, total: monthly.exp };
      window[b.chartVar] = new Chart(ctx, { type: 'doughnut', data: { labels: cats.map(c => c.name), datasets: [{ data: cats.map(c => c.value), backgroundColor: cats.map(c => c.color), borderColor: isLight ? '#fff' : '#0f172a', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: legendColor, font: { size: 12 }, padding: 10 } }, tooltip: { callbacks: { label: (ctx) => { const v = ctx.parsed; const total = ctx.dataset.data.reduce((a,b) => a+b, 0); const pct = total > 0 ? (v / total * 100).toFixed(1) : 0; return `${ctx.label}: ${v.toLocaleString()} ج (${pct}%)`; } } } } } });
    });
    const tbody = document.getElementById('expenseBreakdownTableBody');
    if (tbody) {
      const allCatNames = new Set();
      Object.values(tableData).forEach(d => { (d.cats || []).forEach(c => allCatNames.add(c.name)); });
      let html = '';
      Array.from(allCatNames).forEach(catName => {
        const jVal = (tableData['الجعافرة']?.cats || []).find(c => c.name === catName)?.value || 0;
        const bVal = (tableData['بهتيم']?.cats || []).find(c => c.name === catName)?.value || 0;
        html += `<tr><td style="text-align:right; color:var(--text);">${catName}</td><td style="color:#16a34a;">${jVal.toLocaleString()} ج</td><td style="color:#d97706;">${bVal.toLocaleString()} ج</td><td style="color:#0284c7; font-weight:bold;">${(jVal + bVal).toLocaleString()} ج</td></tr>`;
      });
      html += `<tr style="background:rgba(22,163,74,0.1); font-weight:bold;"><td style="text-align:right; color:var(--primary-glow);">الإجمالي</td><td style="color:#16a34a;">${(tableData['الجعافرة']?.total || 0).toLocaleString()} ج</td><td style="color:#d97706;">${(tableData['بهتيم']?.total || 0).toLocaleString()} ج</td><td style="color:#0284c7;">${((tableData['الجعافرة']?.total || 0) + (tableData['بهتيم']?.total || 0)).toLocaleString()} ج</td></tr>`;
      tbody.innerHTML = html;
    }
  };

  window.renderTopSellers = function() {
    const tbody = document.getElementById('topSellersTableBody'); if (!tbody) return;
    const branchSel = document.getElementById('topSellersBranchSel');
    if (!branchSel) return;
    const branchFilter = branchSel.value;

    let monthFilterEl = document.getElementById('topSellersMonthSel');
    if (!monthFilterEl) {
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'topSellersMonthSel';
        monthFilterEl.className = branchSel.className;
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `<option value="latest">آخر شهر متاح</option><option value="2026-10">أكتوبر 2026</option><option value="2026-09">سبتمبر 2026</option><option value="2025-10">أكتوبر 2025</option><option value="2025-09">سبتمبر 2025</option>`;
        monthFilterEl.onchange = window.renderTopSellers;
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    const monthFilter = monthFilterEl.value;
    
    let targetMonth = null;
    if (monthFilter === 'latest') {
        const period = findLatestReportMonth();
        targetMonth = period ? period.month : null;
    } else {
        targetMonth = monthFilter.split('-')[1];
    }

    let tests = [];
    if (branchFilter === 'combined') {
      const dataJ = getTestMovementData('الجعافرة', targetMonth);
      const dataB = getTestMovementData('بهتيم', targetMonth);
      const combinedTests = {};
      const originalNames = {};
      const processTest = (t) => {
          const key = t.name.trim().toLowerCase();
          if (!originalNames[key]) originalNames[key] = t.name.trim();
          combinedTests[key] = (combinedTests[key] || 0) + t.count;
      };
      dataJ.forEach(processTest);
      dataB.forEach(processTest);
      tests = Object.keys(combinedTests).map(k => ({ name: originalNames[k], count: combinedTests[k] }));
    } else {
      const branchName = branchFilter === 'jaafara' ? 'الجعافرة' : 'بهتيم';
      tests = getTestMovementData(branchName, targetMonth);
    }

    tests = tests.filter(t => t.count > 0);
    if(!tests || tests.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px;">لا توجد بيانات</td></tr>'; return; }
    tests.sort((a, b) => b.count - a.count);
    let html = '';
    tests.slice(0, 20).forEach((test, index) => { html += `<tr><td style="color:var(--gold);">${index + 1}</td><td style="color: var(--text); text-align:right;">${test.name}</td><td style="color: #0284c7; font-weight:bold;">${test.count}</td></tr>`; });
    tbody.innerHTML = html;
  };

  window.renderMostProfitable = function() {
    const tbody = document.getElementById('mostProfitableTableBody'); if (!tbody) return;
    const branchSel = document.getElementById('mostProfBranchSel');
    if (!branchSel) return;
    const branchFilter = branchSel.value;

    let monthFilterEl = document.getElementById('mostProfMonthSel');
    if (!monthFilterEl) {
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'mostProfMonthSel';
        monthFilterEl.className = branchSel.className;
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `<option value="latest">آخر شهر متاح</option><option value="2026-10">أكتوبر 2026</option><option value="2026-09">سبتمبر 2026</option><option value="2025-10">أكتوبر 2025</option><option value="2025-09">سبتمبر 2025</option>`;
        monthFilterEl.onchange = window.renderMostProfitable;
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    const monthFilter = monthFilterEl.value;

    let data = getMergedData(branchFilter, monthFilter);
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">لا توجد تطابق</td></tr>'; return; }
    data.sort((a, b) => b.trueTotalProfit - a.trueTotalProfit);
    let html = '';
    data.slice(0, 20).forEach((test, index) => { html += `<tr><td style="color:var(--gold);">${index + 1}</td><td style="color: var(--text); text-align:right;">${test.name}</td><td style="color: #16a34a;">${test.sell} ج</td><td style="color: #dc2626;">${test.trueCost.toFixed(1)} ج</td><td style="color: #d97706;">${test.trueProfitUnit.toFixed(1)} ج</td><td style="color: #16a34a; font-weight:bold;">${test.trueTotalProfit.toLocaleString()} ج</td></tr>`; });
    tbody.innerHTML = html;
  };

  window.renderLeastProfitable = function() {
    const tbody = document.getElementById('leastProfitableTableBody'); if (!tbody) return;
    const branchSel = document.getElementById('leastProfBranchSel');
    if (!branchSel) return;
    const branchFilter = branchSel.value;

    let monthFilterEl = document.getElementById('leastProfMonthSel');
    if (!monthFilterEl) {
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'leastProfMonthSel';
        monthFilterEl.className = branchSel.className;
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `<option value="latest">آخر شهر متاح</option><option value="2026-10">أكتوبر 2026</option><option value="2026-09">سبتمبر 2026</option><option value="2025-10">أكتوبر 2025</option><option value="2025-09">سبتمبر 2025</option>`;
        monthFilterEl.onchange = window.renderLeastProfitable;
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    const monthFilter = monthFilterEl.value;

    let data = getMergedData(branchFilter, monthFilter);
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">لا توجد تطابق</td></tr>'; return; }
    let profitableOnly = data.filter(t => t.trueProfitUnit > 0);
    profitableOnly.sort((a, b) => a.trueTotalProfit - b.trueTotalProfit);
    let html = '';
    profitableOnly.slice(0, 20).forEach((test, index) => { html += `<tr><td style="color:var(--gold);">${index + 1}</td><td style="color: var(--text); text-align:right;">${test.name}</td><td style="color: #16a34a;">${test.sell} ج</td><td style="color: #dc2626;">${test.trueCost.toFixed(1)} ج</td><td style="color: #d97706;">${test.trueProfitUnit.toFixed(1)} ج</td><td style="color: #d97706; font-weight:bold;">${test.trueTotalProfit.toLocaleString()} ج</td></tr>`; });
    tbody.innerHTML = html;
  };

  window.renderNeedOffers = function() {
    const tbody = document.getElementById('needOffersTableBody'); if (!tbody) return;
    const branchSel = document.getElementById('needOffersBranchSel');
    if (!branchSel) return;
    const branchFilter = branchSel.value;

    let monthFilterEl = document.getElementById('needOffersMonthSel');
    if (!monthFilterEl) {
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'needOffersMonthSel';
        monthFilterEl.className = branchSel.className;
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `<option value="latest">آخر شهر متاح</option><option value="2026-10">أكتوبر 2026</option><option value="2026-09">سبتمبر 2026</option><option value="2025-10">أكتوبر 2025</option><option value="2025-09">سبتمبر 2025</option>`;
        monthFilterEl.onchange = window.renderNeedOffers;
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    const monthFilter = monthFilterEl.value;

    let data = getMergedData(branchFilter, monthFilter);
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px;">لا توجد تطابق</td></tr>'; return; }
    let needs = data.filter(t => t.count < 5 && t.sell > 0);
    needs.sort((a, b) => a.count - b.count);
    let html = '';
    needs.slice(0, 50).forEach((test) => { html += `<tr><td style="color: var(--text); text-align:right;">${test.name}</td><td style="color: #16a34a;">${test.sell} ج</td><td style="color: #dc2626; font-weight:bold;">${test.count} مرات</td></tr>`; });
    tbody.innerHTML = html;
  };

  window.renderLossMakers = function() {
    const tbody = document.getElementById('lossMakersTableBody'); if (!tbody) return;
    const branchSel = document.getElementById('lossMakersBranchSel');
    if (!branchSel) return;
    const branchFilter = branchSel.value;

    let monthFilterEl = document.getElementById('lossMakersMonthSel');
    if (!monthFilterEl) {
        monthFilterEl = document.createElement('select');
        monthFilterEl.id = 'lossMakersMonthSel';
        monthFilterEl.className = branchSel.className;
        monthFilterEl.style.marginRight = '10px';
        monthFilterEl.innerHTML = `<option value="latest">آخر شهر متاح</option><option value="2026-10">أكتوبر 2026</option><option value="2026-09">سبتمبر 2026</option><option value="2025-10">أكتوبر 2025</option><option value="2025-09">سبتمبر 2025</option>`;
        monthFilterEl.onchange = window.renderLossMakers;
        branchSel.parentNode.insertBefore(monthFilterEl, branchSel.nextSibling);
    }
    const monthFilter = monthFilterEl.value;

    let data = getMergedData(branchFilter, monthFilter);
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد تطابق</td></tr>'; return; }
    let losers = data.filter(t => t.trueCost > t.sell);
    losers.sort((a, b) => a.trueProfitUnit - b.trueProfitUnit);
    let html = '';
    losers.forEach((test) => { html += `<tr><td style="color: var(--text); text-align:right;">${test.name}</td><td style="color: #16a34a;">${test.sell} ج</td><td style="color: #dc2626;">${test.trueCost.toFixed(1)} ج</td><td style="color: #dc2626; font-weight:bold;">${test.trueProfitUnit.toFixed(1)} ج</td></tr>`; });
    tbody.innerHTML = html;
  };

  window.openAIAssistant = function() {
    const modal = document.getElementById('aiModal');
    const body = document.getElementById('aiModalBody');
    if (!modal || !body) return;
    modal.classList.add('show');
    if (!salesWorkbook) { body.innerHTML = `<p style="color:#dc2626; font-weight:bold;">⚠️ ارفع الملفات أولاً.</p>`; return; }
    let insights = `<p style="color:var(--primary-glow); font-weight:bold; font-size:1.1rem;">أهلاً يا دكتور أحمد! 👨‍⚕️</p><p>تحليل سريع للبيانات (بناءً على التكلفة الحقيقية):</p><ul style="line-height:2;">`;
    const merged = getMergedData('combined');
    if (merged.length > 0) {
      const totalTrueProfit = merged.reduce((a, t) => a + t.trueTotalProfit, 0);
      const losers = merged.filter(t => t.trueCost > t.sell).length;
      insights += `<li>💼 إجمالي الربح الصافي الحقيقي: <strong>${totalTrueProfit.toLocaleString()} ج</strong></li>`;
      insights += `<li>📊 عدد التحاليل المطابقة: <strong>${merged.length}</strong></li>`;
      if (losers > 0) insights += `<li style="color:#dc2626;">⚠️ <strong>${losers}</strong> تحليل خاسر بعد حساب الثوابت.</li>`;
    } else { insights += `<li>ℹ️ محتاج ترفع ملف الأسعار عشان أحلل الأرباح</li>`; }
    insights += `</ul><p style="text-align:center; margin-top:20px; color:var(--text-muted); font-size:0.9rem;">${TEBA_CONFIG.lab.name} دايماً في تقدم! 🚀</p>`;
    body.innerHTML = insights;
  };

  window.closeAIAssistant = function() { const modal = document.getElementById('aiModal'); if (modal) modal.classList.remove('show'); };

  window.copyAIReport = async function(type) {
    if (!salesWorkbook) { alert('⚠️ لازم ترفع ملفات الإكسل الأول عشان أقدر أحلل.'); return; }
    const period = findLatestReportMonth();
    if (!period) { alert('⚠️ مفيش بيانات كفاية.'); return; }

    const monthsAr = ['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
    const monthName = monthsAr[period.month - 1];
    const currJ = extractMonthData(period.year, period.month, 'الجعافرة');
    const currB = extractMonthData(period.year, period.month, 'بهتيم');
    const currRev = currJ.rev + currB.rev; const currExp = currJ.exp + currB.exp;
    const currProfit = currRev - currExp; const currCases = currJ.cases + currB.cases;
    const margin = currRev > 0 ? (currProfit / currRev * 100).toFixed(1) : 0;

    const merged = getMergedData('combined');
    const topProfitable = [...merged].sort((a, b) => b.trueTotalProfit - a.trueTotalProfit).slice(0, 5);
    const losingTests = merged.filter(t => t.trueCost > t.sell && t.count > 0).sort((a, b) => a.trueProfitUnit - b.trueProfitUnit).slice(0, 5);
    const topSellers = [...merged].sort((a, b) => b.count - a.count).slice(0, 5);

    let prompt = `أنت الآن "مستشار مالي وتشغيلي واستراتيجي" خبير في إدارة المعامل الطبية. أنا الدكتور أحمد طه، صاحب "${TEBA_CONFIG.lab.name}".\n`;
    prompt += `أحتاج منك تقريراً استشارياً شاملاً ومفصلاً. بناءً على البيانات التالية لشهر ${monthName} ${period.year}:\n\n`;
    prompt += `📊 **[1] المؤشرات المالية:**\n`;
    prompt += `- الإيراد: ${currRev.toLocaleString()} ج، المصاريف: ${currExp.toLocaleString()} ج، صافي الربح: ${currProfit.toLocaleString()} ج (هامش الربح ${margin}%).\n`;
    prompt += `- فرع الجعافرة: إيراد ${currJ.rev.toLocaleString()} ج، حالات ${currJ.cases.toLocaleString()} (متوسط فاتورة ${(currJ.rev/currJ.cases).toFixed(1)} ج).\n`;
    prompt += `- فرع بهتيم: إيراد ${currB.rev.toLocaleString()} ج، حالات ${currB.cases.toLocaleString()} (متوسط فاتورة ${(currB.rev/currB.cases).toFixed(1)} ج).\n`;
    prompt += `- إجمالي الحالات: ${currCases.toLocaleString()} حالة.\n\n`;
    prompt += `🔬 **[2] أداء التحاليل (بناءً على التكلفة الحقيقية):**\n`;
    prompt += `- الأكثر مبيعاً: ${topSellers.map(t => `${t.name} (${t.count} مرة)`).join('، ')}.\n`;
    prompt += `- الأكثر ربحاً: ${topProfitable.map(t => `${t.name} (ربح ${t.trueTotalProfit.toLocaleString()} ج)`).join('، ')}.\n`;
    if (losingTests.length > 0) prompt += `- التحاليل الخاسرة: ${losingTests.map(t => `${t.name} (خسارة ${Math.abs(t.trueProfitUnit).toFixed(1)} ج/تحليل)`).join('، ')}.\n`;
    prompt += `\n🎯 **المطلوب منك كخبير (اكتب تقرير مفصل ومقسم للعناوين دي):**\n`;
    prompt += `1. **التحليل المالي والعددي:** تقييم الأرباح، الهوامش، ومقارنة كفاءة الفروع (مين بيجيب حالات أكتر ومين فاتورته أعلى؟).\n`;
    prompt += `2. **التشغيل والحالات:** تحليل أعداد الحالات وعلاقتها بالإيراد، وإيه اللي ممكن يتحسن في استقبال الحالات.\n`;
    prompt += `3. **التطوير والتحاليل:** بناءً على بيانات التحاليل اللي فوق، إيه الفرص اللي ممكن نستغلها (زي تسويق التحاليل المربحة أو تعديل أسعار الخاسرة)؟\n`;
    prompt += `4. **خطة عمل تنفيذية (Action Plan):** اعطني 5 قرارات أو خطوات عملية ومحددة جداً عشان أنفذها الشهر القادم لتحسين التشغيل وزيادة الأرباح.\n`;
    prompt += `\n(ملاحظة: اكتب بلغة عربية واضحة ومباشرة، وبدون مقدمات إنشائية).`;

    const modal = document.getElementById('aiModal');
    const body = document.getElementById('aiModalBody');
    if (modal && body) {
      body.innerHTML = `<div style="text-align:center; padding: 40px;"><div class="loading-spinner" style="margin: 0 auto 20px; border-top-color: var(--primary-glow);"></div><p style="color:var(--primary-glow); font-weight:bold; font-size:1.1rem;">⏳ جاري استشارة المحلل الذكي...<br><span style="font-size:0.85rem; color:var(--text-muted); font-weight:normal;">قد يستغرق الأمر بضع ثوانٍ.</span></p></div>`;
      modal.classList.add('show');
    }

    try {
      const response = await fetch('https://teba-ai.aabunada20.workers.dev/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      let aiText = data.result;
      aiText = aiText.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--gold); font-size:1.1rem;">$1</strong>');
      aiText = aiText.replace(/\n/g, '<br>');
      aiText = aiText.replace(/- (.*?)(<br>|$)/g, '<li style="margin-right:20px; margin-bottom:8px;">$1</li>');
      if (body) body.innerHTML = `<div style="line-height: 1.8; font-size: 0.95rem;">${aiText}</div>`;
    } catch (error) {
      if (body) body.innerHTML = `<p style="color:#dc2626; font-weight:bold; text-align:center; padding:20px;">❌ حدث خطأ أثناء الاتصال بالمستشار الذكي: <br><br>${error.message}<br><br>تأكد من إعدادات الـ API Key في Cloudflare.</p>`;
    }
  };

  window.copyToAnyAI = function(type) {
    if (!salesWorkbook) { alert('⚠️ لازم ترفع الملفات الأول عشان أقدر أطلع تقرير.'); return; }
    const period = findLatestReportMonth(); if (!period) return;
    const monthsAr = ['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
    const monthName = monthsAr[period.month - 1];
    const currJ = extractMonthData(period.year, period.month, 'الجعافرة'); const currB = extractMonthData(period.year, period.month, 'بهتيم');
    const currRev = currJ.rev + currB.rev; const currExp = currJ.exp + currB.exp; const currProfit = currRev - currExp;
    const margin = currRev > 0 ? (currProfit / currRev * 100).toFixed(1) : 0;
    const merged = getMergedData('combined');
    const topProfitable = [...merged].sort((a, b) => b.trueTotalProfit - a.trueTotalProfit).slice(0, 5);
    const losingTests = merged.filter(t => t.trueCost > t.sell && t.count > 0).sort((a, b) => a.trueProfitUnit - b.trueProfitUnit).slice(0, 5);

    let prompt = `أهلاً. أنت الآن "مستشار مالي وتشغيلي" خبير في إدارة المعامل الطبية. أنا الدكتور أحمد طه، صاحب "${TEBA_CONFIG.lab.name}".\n`;
    prompt += `أحتاج منك تحليل شامل ودراسة استراتيجية بناءً على البيانات التالية. أرجو أن يكون ردك عملياً ومبنياً على الأرقام، وبدون مقدمات إنشائية.\n\n`;
    prompt += `📍 **[1] بيانات الشهر الحالي (${monthName} ${period.year}):**\n`;
    prompt += `- الإجمالي: إيراد ${currRev.toLocaleString()} ج، مصاريف ${currExp.toLocaleString()} ج، صافي ربح ${currProfit.toLocaleString()} ج (هامش ${margin}%).\n`;
    prompt += `- فرع الجعافرة: إيراد ${currJ.rev.toLocaleString()} ج، مصاريف ${currJ.exp.toLocaleString()} ج، عدد الحالات ${currJ.cases.toLocaleString()} حالة.\n`;
    prompt += `- فرع بهتيم: إيراد ${currB.rev.toLocaleString()} ج، مصاريف ${currB.exp.toLocaleString()} ج، عدد الحالات ${currB.cases.toLocaleString()} حالة.\n\n`;
    prompt += `💎 **[2] التحاليل (بناءً على التكلفة الحقيقية):**\n- أفضل 5 تحاليل ربحية (النجوم):\n`;
    topProfitable.forEach((t, i) => { prompt += `  ${i+1}. ${t.name}: ربح صافي (${t.trueProfitUnit.toFixed(1)} ج)، إجمالي (${t.trueTotalProfit.toLocaleString()} ج).\n`; });
    if (losingTests.length > 0) {
      prompt += `- أسوأ 5 تحاليل (خاسرة):\n`;
      losingTests.forEach((t, i) => { prompt += `  ${i+1}. ${t.name}: سعر البيع ${t.sell} ج، التكلفة ${t.trueCost.toFixed(1)} ج (خسارة ${Math.abs(t.trueProfitUnit).toFixed(1)} ج/تحليل).\n`; });
    }
    prompt += `\n🎯 **المطلوب منك كخبير:**\n1. **التحليل المالي والعددي:** تقييم الأرباح، الهوامش، ومقارنة كفاءة الفروع.\n2. **التشغيل والحالات:** تحليل أعداد الحالات وعلاقتها بالإيراد.\n3. **التطوير والتحاليل:** الفرص اللي ممكن نستغلها بناءً على بيانات التحاليل.\n4. **خطة عمل تنفيذية:** 5 قرارات عملية لتنفيذها الشهر القادم.\n`;

    navigator.clipboard.writeText(prompt).then(() => {
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg, #4d6bfe, #3b5bdb);color:#fff;padding:15px 30px;border-radius:12px;font-weight:bold;font-size:1.1rem;z-index:999999;box-shadow:0 10px 30px rgba(0,0,0,0.5);text-align:center;direction:rtl;';
      toast.innerHTML = `✅ تم نسخ التقرير الشامل بنجاح!<br><span style="font-size:0.85rem;font-weight:normal;opacity:0.9;">افتح أي تطبيق ذكاء اصطناعي والصق النص هناك.</span>`;
      document.body.appendChild(toast); setTimeout(() => toast.remove(), 4000);
    }).catch(err => { alert('❌ فشل نسخ النص: ' + err); });
  };

  window.filterTable = function(input, tableId) {
    const filter = input.value.toLowerCase(); const table = document.getElementById(tableId); if (!table) return;
    const tr = table.getElementsByTagName("tr");
    for (let i = 1; i < tr.length; i++) {
        const txtValue = (tr[i].textContent || tr[i].innerText).toLowerCase();
        tr[i].style.display = txtValue.indexOf(filter) > -1 ? "" : "none";
    }
  };

  /* ============= INIT ============= */
  initTheme();
  
  _supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      showDashboard();
    }
  });

  _supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      showDashboard();
    } else if (event === 'SIGNED_OUT') {
      location.reload();
    }
  });

  const passInput = document.getElementById('adminPassword');
  if(passInput) passInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.checkAdminPassword(); });
  const emailInput = document.getElementById('adminEmail');
  if(emailInput) emailInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.checkAdminPassword(); });

  /* ============= PWA INSTALL LOGIC ============= */
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'inline-flex'; 
  });

  window.installPWA = async function() {
    if (!deferredPrompt) { alert('التطبيق مثبت بالفعل أو متصفحك لا يدعم هذه الميزة.'); return; }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { const installBtn = document.getElementById('pwaInstallBtn'); if (installBtn) installBtn.style.display = 'none'; }
    deferredPrompt = null;
  };
  // ==== تقرير التحاليل التفصيلي (الجديد) ====
  window.renderTestReport = async function() {
      const fromDate = document.getElementById('testReportFrom').value;
      const toDate = document.getElementById('testReportTo').value;
      const searchQuery = document.getElementById('testReportSearch').value.trim().toLowerCase();
      const tbody = document.getElementById('testReportBody');

      if (!fromDate || !toDate) return alert('يرجى اختيار تاريخ البداية والنهاية أولاً');

      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">جاري البحث في السحابة...</td></tr>';
      showLoading('جاري تجهيز تقرير التحاليل...');

      try {
          // 1. جلب الزيارات في الفترة المحددة
          const { data: visits, error: vErr } = await _supabase.from('visits')
              .select('visit_id')
              .eq('tenant_id', TEBA_CONFIG.tenant.id)
              .gte('visit_date', new Date(fromDate).toISOString())
              .lte('visit_date', new Date(toDate + 'T23:59:59').toISOString());

          if (vErr) throw vErr;
          if (!visits || visits.length === 0) {
              tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger);">لا توجد زيارات في هذه الفترة</td></tr>';
              hideLoading();
              return;
          }

          const visitIds = visits.map(v => v.visit_id);
          let allVTs = [];

          // 2. جلب التحاليل التابعة لهذه الزيارات (على دفعات لتجنب مشاكل السحابة لو العدد كبير)
          for (let i = 0; i < visitIds.length; i += 500) {
              const chunk = visitIds.slice(i, i + 500);
              const { data: vts, error: vtErr } = await _supabase.from('visit_tests')
                  .select('test_code, price_at_time')
                  .eq('tenant_id', TEBA_CONFIG.tenant.id)
                  .in('visit_id', chunk)
                  .eq('is_cancelled', false); // استبعاد التحاليل الملغية
              if (vtErr) throw vtErr;
              if (vts) allVTs = allVTs.concat(vts);
          }

          // 3. جلب أسماء التحاليل من الكتالوج
          const { data: catalog, error: cErr } = await _supabase.from('tests_catalog')
              .select('code, name')
              .eq('tenant_id', TEBA_CONFIG.tenant.id);
          if (cErr) throw cErr;

          const nameMap = {};
          catalog.forEach(c => { nameMap[c.code] = c.name; });

          // 4. حساب الإحصائيات
          const report = {};
          allVTs.forEach(vt => {
              const code = vt.test_code;
              const name = nameMap[code] || code;
              
              // فلترة البحث
              if (searchQuery && !name.toLowerCase().includes(searchQuery) && !code.toLowerCase().includes(searchQuery)) return;

              if (!report[code]) {
                  report[code] = { name: name, count: 0, total: 0 };
              }
              report[code].count += 1;
              report[code].total += parseFloat(vt.price_at_time || 0);
          });

          const results = Object.values(report).sort((a,b) => b.count - a.count);

          // 5. عرض النتائج
          if (results.length === 0) {
              tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">لا توجد نتائج مطابقة للبحث</td></tr>';
          } else {
              tbody.innerHTML = results.map(r => `
                  <tr>
                      <td style="text-align:right; font-weight:bold; color:var(--text);">${r.name}</td>
                      <td style="color:#0284c7; font-weight:bold;">${r.count}</td>
                      <td style="color:#16a34a; font-weight:bold;">${r.total.toLocaleString()} ج</td>
                  </tr>
              `).join('');
          }

      } catch(err) {
          console.error(err);
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">حدث خطأ أثناء البحث</td></tr>';
      } finally {
          hideLoading();
      }
  };
})();