/* =====================================================
   TEBA LABS - Advanced Features (Refactored v2)
   معامل طيبة - الميزات المتقدمة
   =====================================================
   - Toast Notifications
   - Booking System (with Validation)
   - Legal Pages
   - PWA Registration & Install Prompt
   ===================================================== */

(function(){
  'use strict';

  const D = window.TEBA_DATA;
  const APP_CONFIG = D.APP_CONFIG;

  /* =====================================================
     1. TOAST NOTIFICATIONS
     ===================================================== */
  let toastContainer = null;

  function ensureToastContainer(){
    if(toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('role','status');
    toastContainer.setAttribute('aria-live','polite');
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  window.showToast = function(msg, type='info', duration=3500){
    const container = ensureToastContainer();
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" aria-label="إغلاق">✕</button>
    `;
    const closeBtn = toast.querySelector('.toast-close');
    const removeToast = () => {
      toast.classList.add('hide');
      setTimeout(()=>{ if(toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    };
    closeBtn.addEventListener('click', removeToast);
    container.appendChild(toast);
    setTimeout(removeToast, duration);
  };

  /* =====================================================
     2. BOOKING SYSTEM (With Validation)
     ===================================================== */
  let currentBookingStep = 1;
  const totalBookingSteps = 4;

  function validateStep(step){
    if(step === 1){
      const name = document.getElementById('bkName')?.value.trim();
      const phone = document.getElementById('bkPhone')?.value.trim();
      if(!name || name.length < 3){
        window.showToast('من فضلك اكتب الاسم بالكامل (3 حروف على الأقل)', 'error');
        return false;
      }
      // التحقق من صحة رقم الموبايل المصري
      const phoneRegex = /^01[0125][0-9]{8}$/;
      if(!phone || !phoneRegex.test(phone)){
        window.showToast('من فضلك اكتب رقم موبايل مصري صحيح (مثال: 01012345678)', 'error');
        return false;
      }
    }
    
    if(step === 2){
      const gov = document.getElementById('bkGovernorate')?.value;
      const area = document.getElementById('bkArea')?.value.trim();
      const address = document.getElementById('bkAddress')?.value.trim();
      if(!gov || !area || !address){
        window.showToast('من فضلك أكمل بيانات العنوان (المحافظة، المنطقة، العنوان بالتفصيل)', 'error');
        return false;
      }
    }

    if(step === 3){
      const date = document.getElementById('bkDate')?.value;
      const time = document.getElementById('bkTime')?.value;
      if(!date || !time){
        window.showToast('من فضلك اختر تاريخ ووقت السحب', 'error');
        return false;
      }
    }
    
    return true;
  }

  function goToBookingStep(step){
    if(step < 1 || step > totalBookingSteps) return;
    
    // تحقق قبل الانتقال للأمام
    if(step > currentBookingStep){
      if(!validateStep(currentBookingStep)) return;
    }

    currentBookingStep = step;
    document.querySelectorAll('.booking-page').forEach(p=>p.classList.remove('active'));
    const target = document.querySelector(`.booking-page[data-step="${step}"]`);
    if(target) target.classList.add('active');

    document.querySelectorAll('.booking-step').forEach(s=>{
      const n = parseInt(s.dataset.step);
      s.classList.toggle('active', n === step);
      s.classList.toggle('done', n < step);
    });

    if(step === totalBookingSteps) buildBookingSummary();
  }

  function buildBookingSummary(){
    const summaryEl = document.getElementById('bookingSummary');
    if(!summaryEl) return;

    const name = document.getElementById('bkName')?.value.trim() || '';
    const phone = document.getElementById('bkPhone')?.value.trim() || '';
    const governorate = document.getElementById('bkGovernorate')?.value || '';
    const area = document.getElementById('bkArea')?.value.trim() || '';
    const address = document.getElementById('bkAddress')?.value.trim() || '';
    const date = document.getElementById('bkDate')?.value || '';
    const time = document.getElementById('bkTime')?.value || '';
    const notes = document.getElementById('bkNotes')?.value.trim() || '';

    const items = JSON.parse(localStorage.getItem('teba_cart') || '[]');
    const itemsList = items.length > 0
      ? items.map(i=>'• ' + i.ar).join('<br>')
      : '<em>لا يوجد تحاليل مختارة - سيتم التحديد مع الفريق</em>';

    summaryEl.innerHTML = `
      <div style="background:rgba(0,255,127,.05);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
        <h4 style="color:var(--primary-glow);margin-bottom:10px">📋 ملخص الحجز</h4>
        <p><strong>الاسم:</strong> ${name}</p>
        <p><strong>الموبايل:</strong> ${phone}</p>
        <p><strong>العنوان:</strong> ${governorate} - ${area} - ${address}</p>
        <p><strong>التاريخ:</strong> ${date} - ${time}</p>
        ${notes ? `<p><strong>ملاحظات:</strong> ${notes}</p>` : ''}
      </div>
      <div style="background:rgba(0,255,127,.05);border:1px solid var(--border);border-radius:12px;padding:16px">
        <h4 style="color:var(--primary-glow);margin-bottom:10px">🧪 التحاليل المختارة</h4>
        <p style="line-height:2">${itemsList}</p>
      </div>
    `;
  }

  function submitBooking(){
    // تحقق نهائي من جميع البيانات قبل الإرسال
    if(!validateStep(1) || !validateStep(2) || !validateStep(3)) return;

    const name = document.getElementById('bkName')?.value.trim();
    const phone = document.getElementById('bkPhone')?.value.trim();
    const governorate = document.getElementById('bkGovernorate')?.value;
    const area = document.getElementById('bkArea')?.value.trim();
    const address = document.getElementById('bkAddress')?.value.trim();
    const date = document.getElementById('bkDate')?.value;
    const time = document.getElementById('bkTime')?.value;
    const notes = document.getElementById('bkNotes')?.value.trim() || '';

    const items = JSON.parse(localStorage.getItem('teba_cart') || '[]');
    const itemsText = items.length > 0
      ? items.map(i=>'• ' + i.ar).join('\n')
      : 'سيتم التحديد مع الفريق';

    const msg = `🏠 *طلب سحب من المنزل*\n\n` +
      `👤 الاسم: ${name}\n` +
      `📱 الموبايل: ${phone}\n` +
      `📍 العنوان: ${governorate} - ${area}\n${address}\n` +
      `📅 التاريخ: ${date}\n` +
      `⏰ الوقت: ${time}\n\n` +
      `🧪 التحاليل:\n${itemsText}\n\n` +
      (notes ? `📝 ملاحظات: ${notes}` : '');

    window.open('https://wa.me/' + APP_CONFIG.whatsapp + '?text=' + encodeURIComponent(msg), '_blank');
    window.showToast('جاري فتح واتساب لتأكيد الحجز ✅', 'success');
  }

  /* =====================================================
     3. LEGAL PAGES
     ===================================================== */
  const LEGAL_CONTENT = {
    privacy: {
      title: 'سياسة الخصوصية',
      body: `
        <p>في معامل طيبة (TEBA LABS)، نلتزم بحماية خصوصية زوارنا وعملائنا. توضح هذه السياسة كيفية جمعنا واستخدامنا وحمايتنا لبياناتك.</p>
        <h3>1. البيانات التي نجمعها</h3>
        <p>قد نجمع البيانات التالية:</p>
        <ul>
          <li>الاسم ورقم الموبايل عند طلب الحجز أو الاستفسار</li>
          <li>العنوان عند طلب خدمة السحب من المنزل</li>
          <li>بيانات تحليلية مجهولة (عدد الزيارات، الصفحات الأكثر تصفحاً)</li>
        </ul>
        <h3>2. كيف نستخدم بياناتك</h3>
        <ul>
          <li>تنفيذ طلبات الحجز والسحب المنزلي</li>
          <li>التواصل معك لتسليم النتائج</li>
          <li>تحسين جودة خدماتنا</li>
        </ul>
        <h3>3. حماية البيانات</h3>
        <p>نتخذ إجراءات أمنية مناسبة لحماية بياناتك من الوصول غير المصرح به. جميع البيانات الطبية محفوظة بسرية تامة وفقاً للمعايير الطبية والقانونية.</p>
        <h3>4. مشاركة البيانات</h3>
        <p>لا نشارك بياناتك مع أي طرف ثالث إلا بموافقتك أو بموجب القانون.</p>
        <h3>5. الإحصاءات</h3>
        <p>نستخدم أداة <a href="https://www.goatcounter.com" target="_blank" rel="noopener" style="color:var(--primary-glow)">GoatCounter</a> لتحليل الزيارات بشكل مجهول ودون استخدام ملفات تعريف ارتباط.</p>
        <h3>6. حقوقك</h3>
        <p>يحق لك في أي وقت طلب الاطلاع على بياناتك أو حذفها. للتواصل: ${APP_CONFIG.phoneDisplay}</p>
        <h3>7. تحديثات السياسة</h3>
        <p>قد نحدّث هذه السياسة من وقت لآخر، وسيتم إشعارك بأي تغييرات جوهرية.</p>
        <p><em>آخر تحديث: أكتوبر 2026</em></p>
      `
    },
    terms: {
      title: 'شروط الاستخدام',
      body: `
        <p>باستخدامك لموقع معامل طيبة (TEBA LABS)، فإنك توافق على الشروط التالية:</p>
        <h3>1. طبيعة الخدمة</h3>
        <p>الموقع يوفر معلومات عن خدمات التحاليل الطبية، ويمكّنك من حجز الخدمات عبر واتساب. الموقع ليس بديلاً عن الاستشارة الطبية المتخصصة.</p>
        <h3>2. الأسعار</h3>
        <p>الأسعار المعروضة على الموقع قابلة للتحديث بدون إشعار مسبق. السعر النهائي يتم تأكيده عند الحجز.</p>
        <h3>3. النتائج</h3>
        <p>نتائج التحاليل تُسلَّم عبر قنوات آمنة. النتائج لا تُغني عن زيارة الطبيب المعالج.</p>
        <h3>4. السحب من المنزل</h3>
        <p>خدمة السحب من المنزل متاحة بالحجز المسبق ووفق مواعيد الخدمة المتاحة. قد يتم تأجيل الموعد في حالات الطوارئ أو الظروف القاهرة.</p>
        <h3>5. الاستخدام المقبول</h3>
        <p>يُمنع استخدام الموقع لأي غرض غير قانوني أو لإرسال بيانات كاذبة.</p>
        <h3>6. الملكية الفكرية</h3>
        <p>جميع محتويات الموقع (نصوص، صور، شعارات) مملوكة لمعامل طيبة ولا يجوز استخدامها بدون إذن.</p>
        <h3>7. إخلاء المسؤولية</h3>
        <p>معامل طيبة غير مسؤول عن أي استخدام غير صحيح للمعلومات المعروضة على الموقع.</p>
        <p><em>آخر تحديث: أكتوبر 2026</em></p>
      `
    },
    refund: {
      title: 'سياسة الاسترداد',
      body: `
        <p>نلتزم في معامل طيبة بأعلى معايير الجودة. توضح السياسة التالية إجراءات الاسترداد:</p>
        <h3>1. قبل سحب العينة</h3>
        <p>يمكنك إلغاء الحجز واسترداد المبلغ كاملاً قبل سحب العينة.</p>
        <h3>2. بعد سحب العينة</h3>
        <p>بعد سحب العينة لا يمكن استرداد المبلغ، إلا في حالات استثنائية يتم تقييمها من قبل الإدارة.</p>
        <h3>3. خطأ في التحليل</h3>
        <p>في حال وجود خطأ واضح من المعمل في إجراء التحليل، يتم إعادة التحليل مجاناً أو استرداد المبلغ.</p>
        <h3>4. التأخير في النتائج</h3>
        <p>في حال التأخير غير المبرر في تسليم النتائج، يتم التواصل مع العميل وتعويضه حسب ما تراه الإدارة مناسباً.</p>
        <h3>5. كيفية طلب الاسترداد</h3>
        <p>لطلب استرداد، تواصل معنا على: ${APP_CONFIG.phoneDisplay} أو واتساب: ${APP_CONFIG.whatsappDisplay}</p>
        <h3>6. مدة الاسترداد</h3>
        <p>يتم معالجة طلبات الاسترداد خلال 7 أيام عمل من تاريخ الموافقة عليها.</p>
        <p><em>آخر تحديث: أكتوبر 2026</em></p>
      `
    }
  };

  window.openLegal = function(type){
    const content = LEGAL_CONTENT[type];
    if(!content) return;
    let modal = document.getElementById('legalModal');
    if(!modal){
      modal = document.createElement('div');
      modal.id = 'legalModal';
      modal.className = 'modal-art';
      modal.innerHTML = `
        <div class="modal-art-content">
          <button class="close-art" onclick="window.closeLegal()" aria-label="إغلاق">✕</button>
          <div class="legal-content" id="legalBody"></div>
        </div>
      `;
      modal.addEventListener('click', e => { if(e.target === modal) window.closeLegal(); });
      document.body.appendChild(modal);
    }
    document.getElementById('legalBody').innerHTML = `<h2>${content.title}</h2>${content.body}`;
    modal.classList.add('show');
  };

  window.closeLegal = function(){
    const modal = document.getElementById('legalModal');
    if(modal) modal.classList.remove('show');
  };

  /* =====================================================
     4. PWA REGISTRATION
     ===================================================== */
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('service-worker.js')
        .then(() => console.log('✅ PWA registered'))
        .catch(err => console.log('PWA registration failed:', err));
    });
  }

  /* =====================================================
     5. INSTALL PROMPT (PWA)
     ===================================================== */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  function showInstallBanner(){
    if(localStorage.getItem('teba_install_dismissed') === 'yes') return;
    if(document.getElementById('installBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'installBanner';
    banner.style.cssText = `
      position:fixed;bottom:20px;left:20px;right:20px;max-width:400px;margin:auto;
      background:var(--bg-card-gradient);border:1px solid var(--border-glow);
      border-radius:16px;padding:16px 20px;z-index:4000;display:flex;gap:12px;align-items:center;
      box-shadow:var(--shadow);animation:toastIn .4s ease-out;
    `;
    banner.innerHTML = `
      <span style="font-size:1.8rem">📱</span>
      <div style="flex:1">
        <strong style="color:var(--primary-glow);font-size:.9rem;display:block">ثبّت التطبيق</strong>
        <span style="color:var(--text-muted);font-size:.78rem">للوصول السريع من شاشة الموبايل</span>
      </div>
      <button id="installBtn" style="background:var(--primary);color:#fff;border:0;padding:8px 16px;border-radius:10px;font-weight:800;font-size:.82rem">تثبيت</button>
      <button id="dismissInstall" style="background:transparent;border:0;color:var(--text-muted);font-size:1.2rem;padding:4px 8px">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('installBtn').addEventListener('click', async ()=>{
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.remove();
      if(outcome === 'accepted') window.showToast('تم التثبيت بنجاح ✅', 'success');
    });
    document.getElementById('dismissInstall').addEventListener('click', ()=>{
      localStorage.setItem('teba_install_dismissed', 'yes');
      banner.remove();
    });
  }

  /* =====================================================
     6. EXPORT FUNCTIONS FOR HTML
     ===================================================== */
  window.goToBookingStep = goToBookingStep;
  window.submitBooking = submitBooking;

})();
