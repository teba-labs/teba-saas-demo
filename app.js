/* =====================================================
   TEBA LABS - Main Application (v123 - SaaS)
   معامل طيبة - التطبيق الرئيسي للواجهة العامة
   ===================================================== */

(function(){
  'use strict';

  /* ============= SHORTCUTS ============= */
  const D = window.TEBA_DATA;
  if (!D) {
      console.error("Data.js not loaded!");
      return;
  }
  
  const {
    TESTS, CAT_ICONS, FEATURED_NAMES, PACKAGES, PACKAGE_DISCOUNT,
    TEST_PREPARATION, MEDICAL_ARTICLES, TESTIMONIALS, TRUST_BADGES,
    APP_CONFIG, OFFER_CONFIG, WORKING_HOURS,
    isNumericPrice, getTestByName, getPackagePrice, isOfferActive,
    normalizeArabic
  } = D;

  /* ============= LOGO FALLBACK ============= */
  window.tryNextLogo = function(img){
    const names = ['logo.png', 'Logo.png', 'logo.jpg'];
    let idx = parseInt(img.dataset.tryIdx || '0');
    if(idx >= names.length){ img.style.display = 'none'; return; }
    img.dataset.tryIdx = idx + 1;
    img.src = names[idx];
  };

  /* ============= STATE ============= */
  let cart = JSON.parse(localStorage.getItem('teba_cart') || '[]');
  let currentCat = 'الكل';
  let currentSearch = '';
  let currentView = 'featured';

  /* ============= DOM REFERENCES ============= */
  const sidebarRight = document.getElementById('sidebarRight');
  const sidebarLeft = document.getElementById('sidebarLeft');
  const overlay = document.getElementById('overlay');
  const themeToggle = document.getElementById('themeToggle');
  const backTop = document.getElementById('backTop');

  /* =====================================================
   1. THEME (Auto + Manual)
   ===================================================== */
  const THEME_KEY = 'teba_theme_user';

  function applyTheme(isLight, isManual){
    document.body.classList.toggle('light-mode', isLight);
    if(themeToggle){
      themeToggle.textContent = isLight ? '🌙' : '☀️';
      themeToggle.setAttribute('aria-label', isLight ? 'الوضع الليلي' : 'الوضع النهاري');
    }
    if(isManual){
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    }
  }

  function detectSystemTheme(){
    const userChoice = localStorage.getItem(THEME_KEY);
    if(userChoice === 'light') return true;
    if(userChoice === 'dark') return false;
    if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){
      return false;
    }
    if(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches){
      return true;
    }
    const hour = new Date().getHours();
    return (hour >= 6 && hour < 18);
  }

  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
      if(!localStorage.getItem(THEME_KEY)){ applyTheme(detectSystemTheme(), false); }
    });
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', ()=>{
      if(!localStorage.getItem(THEME_KEY)){ applyTheme(detectSystemTheme(), false); }
    });
  }

  applyTheme(detectSystemTheme(), false);

  if(themeToggle){
    themeToggle.addEventListener('click', ()=>{
      applyTheme(!document.body.classList.contains('light-mode'), true);
    });
  }

  /* =====================================================
   2. OFFER & TICKER MANAGEMENT
   ===================================================== */
  function renderOffer(){
    const active = isOfferActive();
    const offersTrack = document.getElementById('offersTrack');
    const offerActive = document.getElementById('offerActive');
    const offerExpired = document.getElementById('offerExpired');

    if(offersTrack){
      const tickerItems = [
        `<span class="ticker-item" onclick="showSection('packages')">🎉 خصم 25% على باقات الفحص الشامل — احجز الآن</span>`,
        `<span class="ticker-item" onclick="showSection('packages')">📦 باقة الفحص الشامل (16 تحليل) وفر فلوسك واطمن على صحتك</span>`,
        `<span class="ticker-item" onclick="showSection('packages')">🍬 باقة السكر والدهون لمتابعة صحتك باستمرار</span>`,
        `<span class="ticker-item" onclick="showSection('tests')">🧪 سكر صائم: صيام 8-12 ساعة (الماء مسموح)</span>`,
        `<span class="ticker-item" onclick="showSection('tests')">🧪 دهون كاملة: صيام 9-12 ساعة (تجنب الكحول)</span>`,
        `<span class="ticker-item" onclick="showSection('tests')">🧪 صورة دم كاملة: مش محتاجة صيام، تقدر تعملها في أي وقت</span>`,
        `<span class="ticker-item" onclick="showSection('tests')">🧪 تحليل السائل المنوي: لازم امتناع عن الجماع من 2 لـ 5 أيام</span>`,
        `<span class="ticker-item" onclick="showSection('booking')">🏠 سحب من المنزل بالحجز المسبق — كلمنا واتساب</span>`,
        `<span class="ticker-item" onclick="showSection('results')">📱 استلم نتيجتك عبر واتساب بضغطة واحدة ومجاناً</span>`,
        `<span class="ticker-item" onclick="showSection('medical')">🩺 معلومة: الصيام قبل تحليل السكر بيمنع قراءات خاطئة بتأثر على العلاج</span>`,
        `<span class="ticker-item" onclick="showSection('medical')">🩺 معلومة: تحليل فيتامين د مهم جداً للمناعة وصحة العظام</span>`,
        `<span class="ticker-item" onclick="showSection('medical')">🩺 معلومة: الكشف المبكر عن السكر بيحميك من مضاعفات خطيرة</span>`
      ];

      const tickerHTML = `<div class="ticker-block">${tickerItems.join('')}</div>`;
      offersTrack.innerHTML = tickerHTML + tickerHTML;
    }

    if(offerActive) offerActive.style.display = active ? '' : 'none';
    if(offerExpired) offerExpired.style.display = active ? 'none' : 'block';

    if(active && offerActive){
      const d = OFFER_CONFIG.discount;
      const pct = document.getElementById('offerPct');
      const title = document.getElementById('offerTitle');
      const desc = document.getElementById('offerDesc');
      const period = document.getElementById('offerPeriod');
      const cta = document.getElementById('offerCta');
      if(pct) pct.textContent = d + '%';
      if(title) title.textContent = OFFER_CONFIG.title;
      if(desc) desc.innerHTML = `خصم <strong>${d}%</strong> على كل التحاليل في الفرعين`;
      if(period) period.textContent = '📅 ' + OFFER_CONFIG.periodText;
      if(cta) cta.href = `https://wa.me/${APP_CONFIG.whatsapp}?text=${encodeURIComponent('عايز أستفيد من خصم ' + d + '%')}`;
    }
  }
  renderOffer();
  setInterval(renderOffer, 60 * 60 * 1000);

  /* =====================================================
   3. SIDEBARS
   ===================================================== */
  const toggleRightBtn = document.getElementById('toggleRight');
  const toggleLeftBtn = document.getElementById('toggleLeft');

  if(toggleRightBtn){
    toggleRightBtn.addEventListener('click', ()=>{
      const isMobile = window.innerWidth <= 1000;
      if(isMobile){
        sidebarRight.classList.toggle('collapsed');
        if(!sidebarRight.classList.contains('collapsed')){
          sidebarLeft.classList.add('collapsed');
          overlay.classList.add('show');
        } else {
          overlay.classList.remove('show');
        }
      } else {
        sidebarRight.classList.toggle('collapsed');
      }
    });
  }

  if(toggleLeftBtn){
    toggleLeftBtn.addEventListener('click', ()=>{
      const isMobile = window.innerWidth <= 1000;
      if(isMobile){
        sidebarLeft.classList.toggle('collapsed');
        if(!sidebarLeft.classList.contains('collapsed')){
          sidebarRight.classList.add('collapsed');
          overlay.classList.add('show');
        } else {
          overlay.classList.remove('show');
        }
      } else {
        sidebarLeft.classList.toggle('collapsed');
      }
    });
  }

  window.closeAllSidebars = function(){
    sidebarRight.classList.add('collapsed');
    sidebarLeft.classList.add('collapsed');
    overlay.classList.remove('show');
  };
  overlay.addEventListener('click', window.closeAllSidebars);

  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape'){
      window.closeAllSidebars();
      if(window.closeArticle) closeArticle();
      if(window.closePrep) closePrep();
      if(window.closePkg) closePkg();
    }
  });

  /* =====================================================
   4. NAVIGATION
   ===================================================== */
  window.showSection = function(id){
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    const t = document.getElementById('section-'+id);
    if(t) t.classList.add('active');
    document.querySelectorAll('.nav-list a').forEach(a=>{
      a.classList.toggle('active', a.dataset.section === id);
    });
    window.scrollTo({top:0, behavior:'smooth'});
    if(window.innerWidth <= 1000){
      sidebarRight.classList.add('collapsed');
      sidebarLeft.classList.add('collapsed');
      overlay.classList.remove('show');
    }
  };

  /* =====================================================
   5. GREETING
   ===================================================== */
  function setGreeting(){
    const h = new Date().getHours();
    const el = document.getElementById('greeting');
    if(!el) return;
    let g = '👋 أهلًا بيك في معامل طيبة';
    if(h >= 5 && h < 12) g = '☀️ صباح الخير - أهلًا بيك في معامل طيبة';
    else if(h >= 12 && h < 17) g = '🌤️ نهارك سعيد - أهلًا بيك في معامل طيبة';
    else if(h >= 17 && h < 23) g = '🌙 مساء الخير - أهلًا بيك في معامل طيبة';
    else g = '🌙 أهلًا بيك - مواعيد العمل من 11ص';
    el.textContent = g;
  }
  setGreeting();

  /* =====================================================
   6. BACK TO TOP
   ===================================================== */
  let _scrollRaf = null;
  window.addEventListener('scroll', () => {
    if (_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(() => {
      if(backTop) backTop.classList.toggle('show', window.scrollY > 400);
      _scrollRaf = null;
    });
  }, { passive: true });  /* =====================================================
   7. RENDER PACKAGES
   ===================================================== */
  function renderPackages(){
    const grid = document.getElementById('packagesGrid');
    if(!grid) return;

    grid.innerHTML = PACKAGES.map(pkg => {
      const price = getPackagePrice(pkg);
      const featuredClass = pkg.featured ? ' featured' : '';
      const displayCount = pkg.count || price.available;
      const imgFallback = `this.onerror=null;this.style.display='none';this.parentElement.querySelector('.fallback-icon').style.display='block';`;

      let saveText = '';
      if (price.hasInquiry) {
        saveText = `<span class="package-save" style="background:linear-gradient(135deg,#d4a843,#b8902e)">سعر خاص — استفسر</span>`;
      } else {
        saveText = `<span class="package-save">وفر ${price.total - price.discounted} ج (${PACKAGE_DISCOUNT}%)</span>`;
      }

      return `
        <div class="package-card${featuredClass}">
          <div class="package-image">
            <span class="fallback-icon" style="display:none">${pkg.icon}</span>
            <img src="${pkg.image}" alt="${pkg.name}" loading="lazy" onerror="${imgFallback}">
            ${pkg.featured ? '<span class="package-star">⭐ الأكثر طلبًا</span>' : ''}
            <span class="package-category">🩺 العافية</span>
            <span class="package-count-badge">📊 ${displayCount} تحليل</span>
          </div>
          <div class="package-body">
            <h3 class="package-title">${pkg.name}</h3>
            <p class="package-desc">${pkg.desc}</p>
            <div class="package-divider"></div>
            <div class="package-tests-preview">
              <ul>
                ${pkg.tests.slice(0, 5).map(t => `<li>${t}</li>`).join('')}
              </ul>
              ${pkg.tests.length > 5 ? `<span class="package-more">+ ${displayCount - 5} تحليل إضافي</span>` : ''}
            </div>
            <div class="package-price-area">
              <span class="package-price-old">${price.total} ج</span>
              <span class="package-price-new">${price.discounted}<small> ج</small></span>
              <div>${saveText}</div>
            </div>
            <div class="package-actions">
              <button class="btn-add-pkg" onclick='window.addPackageToCart(${JSON.stringify(pkg.id)})'>📋 أضف لروشتتي</button>
              <button class="btn-view-pkg" onclick='window.showPackageDetails(${JSON.stringify(pkg.id)})'>عرض كل التحاليل</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /* =====================================================
   8. PACKAGE CART
   ===================================================== */
  window.addPackageToCart = function(pkgId){
    const pkg = PACKAGES.find(p => p.id === pkgId);
    if(!pkg) return;
    const price = getPackagePrice(pkg);
    const pkgItem = {
      ar: `📦 ${pkg.name}`,
      price: price.discounted,
      cat: 'باقة',
      en: 'Package',
      isPackage: true
    };
    if(cart.some(c => c.ar === pkgItem.ar)){
      if(window.showToast) window.showToast('الباقة موجودة في روشتتك بالفعل', 'warning');
      else alert('الباقة موجودة في روشتتك بالفعل');
      return;
    }
    cart.push(pkgItem);
    saveCart();
    renderCart();
    renderTests();
    sidebarLeft.classList.remove('collapsed');
    if(window.innerWidth <= 1000) overlay.classList.add('show');
    if(window.showToast) window.showToast('تمت إضافة الباقة لروشتتك ✅', 'success');
  };

  window.showPackageDetails = function(pkgId){
    const pkg = PACKAGES.find(p => p.id === pkgId);
    if(!pkg) return;
    const price = getPackagePrice(pkg);
    let modal = document.getElementById('pkgModal');
    if(!modal){
      modal = document.createElement('div');
      modal.id = 'pkgModal';
      modal.className = 'prep-modal';
      modal.innerHTML = `<div class="prep-modal-content">
        <button class="prep-close" onclick="window.closePkg()">✕</button>
        <h3 id="pkgTitle"></h3>
        <div id="pkgBody"></div>
      </div>`;
      modal.addEventListener('click', e => { if(e.target === modal) window.closePkg(); });
      document.body.appendChild(modal);
    }
    document.getElementById('pkgTitle').textContent = pkg.icon + ' ' + pkg.name;
    document.getElementById('pkgBody').innerHTML = `
      <p style="color:var(--text-muted);margin-bottom:15px">${pkg.desc}</p>
      <ul style="list-style:none;padding:0">
        ${pkg.tests.map(t => {
          const test = getTestByName(t);
          const p = test && isNumericPrice(test.price) ? test.price + ' ج' : 'استفسر';
          return `<li style="padding:10px 0;border-bottom:1px dashed var(--border);display:flex;justify-content:space-between;gap:10px"><span>${t}</span><strong style="color:var(--primary-glow)">${p}</strong></li>`;
        }).join('')}
      </ul>
      <div style="margin-top:20px;background:var(--bg-input);border:1px solid var(--border-glow);border-radius:14px;padding:15px;text-align:center">
        <div style="color:var(--text-muted);font-size:.85rem;text-decoration:line-through">${price.total} ج</div>
        <div style="color:var(--primary-glow);font-size:1.8rem;font-weight:900">${price.discounted} ج</div>
        <div style="color:#f87171;font-weight:800;font-size:.85rem;margin-top:5px">
          ${price.hasInquiry ? 'السعر يشمل التحاليل المحددة فقط — استفسر عن الباقي' : `وفر ${price.total - price.discounted} ج (${PACKAGE_DISCOUNT}% خصم)`}
        </div>
      </div>
      <button class="btn-add-pkg" style="width:100%;padding:14px;border-radius:12px;margin-top:15px;font-weight:800;font-size:1rem" onclick='window.addPackageToCart(${JSON.stringify(pkg.id)});window.closePkg()'>📋 أضف لروشتتي</button>
    `;
    modal.classList.add('show');
  };

  window.closePkg = function(){
    const modal = document.getElementById('pkgModal');
    if(modal) modal.classList.remove('show');
  };

  /* =====================================================
   9. RENDER TESTS & SMART SEARCH
   ===================================================== */
  const grid = document.getElementById('testsGrid');
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const catsBox = document.getElementById('catsBox');
  const resultsCount = document.getElementById('resultsCount');
  const viewToggle = document.getElementById('viewToggle');

  function buildCategories(){
    if(!catsBox) return;
    catsBox.innerHTML = '';
    const cats = ['الكل', ...new Set(TESTS.map(t=>t.cat))];
    cats.forEach(c=>{
      const btn = document.createElement('button');
      btn.className = 'cat-btn' + (c === 'الكل' ? ' active' : '');
      btn.textContent = c;
      btn.onclick = ()=>{
        currentCat = c;
        catsBox.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderTests();
      };
      catsBox.appendChild(btn);
    });
  }

  function bindViewToggle(){
    if(!viewToggle) return;
    viewToggle.querySelectorAll('button').forEach(btn=>{
      btn.onclick = ()=>{
        currentView = btn.dataset.view;
        viewToggle.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderTests();
      };
    });
  }

  function renderTests(){
    if(!grid) return;
    const searchNorm = normalizeArabic(currentSearch);

    const filtered = TESTS.filter(t=>{
      if(currentView === 'featured' && !FEATURED_NAMES.includes(t.ar)) return false;
      if(currentView === 'core' && !t.core) return false;
      if(currentCat !== 'الكل' && t.cat !== currentCat) return false;

      if(searchNorm){
        const testAr = normalizeArabic(t.ar);
        const testCat = normalizeArabic(t.cat);
        const testEn = t.en.toLowerCase();
        if(!testAr.includes(searchNorm) && !testEn.includes(searchNorm) && !testCat.includes(searchNorm)) return false;
      }
      return true;
    });

    if(resultsCount) resultsCount.textContent = filtered.length;
    if(filtered.length === 0){
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);background:var(--bg-card);border:2px dashed var(--border);border-radius:16px"><strong style="color:var(--primary-glow);display:block;font-size:1.1rem;margin-bottom:8px">مفيش نتائج</strong>جرب تكتب اسم تاني</div>';
      return;
    }
    grid.innerHTML = filtered.map(t=>{
      const inCart = cart.some(c=>c.ar === t.ar);
      const icon = CAT_ICONS[t.cat] || '🔬';
      const hasPrep = !!TEST_PREPARATION[t.ar];
      const prepBtn = hasPrep ? `<button class="info-btn" onclick='window.showPrep(${JSON.stringify(t.ar).replace(/'/g,"&#39;")})' title="شروط التحليل">!</button>` : '';
      const priceDisplay = isNumericPrice(t.price) ? t.price + ' ج' : 'استفسر';
      const priceLabel = isNumericPrice(t.price) ? 'السعر' : 'تواصل معنا';
      const safeTest = JSON.stringify(t).replace(/'/g,"&#39;");
      return `<div class="test-item">
        <span class="cat-icon">${icon}</span>
        ${prepBtn}
        <h5>${t.ar}</h5>
        <div class="cat-tag">${t.en ? t.en + ' • ' : ''}${t.cat}</div>
        <div class="price-row">
          <div class="price">${priceDisplay}<small>${priceLabel}</small></div>
          <button class="add-btn ${inCart ? 'added' : ''}" onclick='window.toggleCart(${safeTest})'>${inCart ? '✓ مضاف' : '+ أضف'}</button>
        </div>
      </div>`;
    }).join('');
  }

  if(searchInput){
    searchInput.addEventListener('input', e=>{
      currentSearch = e.target.value;
      if(searchClear) searchClear.classList.toggle('visible', currentSearch.length > 0);
      renderTests();
    });
  }
  if(searchClear){
    searchClear.addEventListener('click', ()=>{
      searchInput.value = '';
      currentSearch = '';
      searchClear.classList.remove('visible');
      searchInput.focus();
      renderTests();
    });
  }

  /* =====================================================
   10. CART (روشتتي)
   ===================================================== */
  function saveCart(){
    localStorage.setItem('teba_cart', JSON.stringify(cart));
  }

  window.toggleCart = function(test){
    const idx = cart.findIndex(c=>c.ar === test.ar);
    if(idx >= 0){
      cart.splice(idx,1);
      if(window.showToast) window.showToast('تم الحذف من روشتتك', 'info');
    } else {
      cart.push(test);
      if(window.showToast) window.showToast('تمت الإضافة لروشتتك ✅', 'success');
    }
    saveCart();
    renderCart();
    renderTests();
  };

  function renderCart(){
    const cartContent = document.getElementById('cartContent');
    const badge = document.getElementById('cartBadge');
    if(!cartContent) return;

    if(cart.length === 0){
      cartContent.innerHTML = '<div class="cart-empty"><div>📋</div>روشتتك فاضية<br><small>اضغط "أضف" على أي تحليل أو باقة</small></div>';
      if(badge) badge.style.display = 'none';
      return;
    }

    let total = 0;
    cart.forEach(t=>{ if(isNumericPrice(t.price)) total += parseInt(t.price); });

    const waMsg = 'مرحبًا دكتور أحمد، عايز أحجز التحاليل دي:\n' +
      cart.map(t=>'• ' + t.ar + ' (' + (isNumericPrice(t.price) ? t.price + ' ج' : 'استفسر عن السعر') + ')').join('\n') +
      '\n\nالإجمالي التقريبي: ' + total + ' ج';

    cartContent.innerHTML = `
      <ul class="cart-list">
        ${cart.map(t=>`
          <li class="cart-item">
            <span class="name">${t.ar}</span>
            <span class="price">${isNumericPrice(t.price) ? t.price + ' ج' : 'استفسر'}</span>
            <button class="remove" onclick='window.removeFromCart(${JSON.stringify(t.ar).replace(/'/g,"&#39;")})'>✕</button>
          </li>
        `).join('')}
      </ul>
      <div class="cart-total">
        <small>الإجمالي التقريبي</small>
        <strong>${total} ج</strong>
        <span class="count">${cart.length} عنصر في روشتتك</span>
      </div>
      <div class="cart-actions">
        <a class="btn-send" href="https://wa.me/${APP_CONFIG.whatsapp}?text=${encodeURIComponent(waMsg)}" target="_blank" rel="noopener noreferrer">💬 أرسل الحجز على واتساب</a>
        <button class="btn-clear" onclick="window.clearCart()">🗑️ تفريغ روشتتي</button>
      </div>
    `;
    if(badge){
      badge.style.display = 'grid';
      badge.textContent = cart.length;
    }
  }

  window.removeFromCart = function(name){
    cart = cart.filter(c=>c.ar !== name);
    saveCart();
    renderCart();
    renderTests();
  };

  window.clearCart = function(){
    if(confirm('تفريغ روشتتك؟')){
      cart = [];
      saveCart();
      renderCart();
      renderTests();
      if(window.showToast) window.showToast('تم تفريغ روشتتك', 'info');
    }
  };  /* =====================================================
   11. REQUEST RESULT (التواصل لطلب النتيجة)
   ===================================================== */
  window.requestResult = function(){
    const nameEl = document.getElementById('rName');
    const phoneEl = document.getElementById('rPhone');
    if(!nameEl || !phoneEl) return;
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    if(!name || !phone){
      if(window.showToast) window.showToast('من فضلك اكتب الاسم ورقم الموبايل', 'error');
      else alert('من فضلك اكتب الاسم ورقم الموبايل');
      return;
    }
    const msg = 'السلام عليكم، أريد استلام نتيجة تحليل:\nالاسم: ' + name + '\nالموبايل: ' + phone;
    window.open('https://wa.me/' + APP_CONFIG.whatsapp + '?text=' + encodeURIComponent(msg), '_blank');
    if(window.showToast) window.showToast('جاري فتح واتساب...', 'success');
  };

  /* =====================================================
   12. PREP MODAL (شروط التحاليل)
   ===================================================== */
  window.showPrep = function(testName){
    const prep = TEST_PREPARATION[testName];
    if(!prep) return;
    let modal = document.getElementById('prepModal');
    if(!modal){
      modal = document.createElement('div');
      modal.id = 'prepModal';
      modal.className = 'prep-modal';
      modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
      modal.innerHTML = `<div class="prep-modal-content">
        <button class="prep-close" onclick="window.closePrep()">✕</button>
        <h3 id="prepTitle"></h3>
        <ul id="prepList"></ul>
      </div>`;
      modal.addEventListener('click', e=>{ if(e.target === modal) window.closePrep(); });
      document.body.appendChild(modal);
    }
    document.getElementById('prepTitle').textContent = 'شروط ' + testName;
    document.getElementById('prepList').innerHTML = `
      <li><strong>الشروط:</strong> ${prep.conditions}</li>
      <li><strong>ملاحظات:</strong> ${prep.notes}</li>
      <li><strong>المصدر:</strong> ${prep.source}</li>
    `;
    modal.classList.add('show');
  };

  window.closePrep = function(){
    const modal = document.getElementById('prepModal');
    if(modal) modal.classList.remove('show');
  };

  /* =====================================================
   13. MEDICAL ARTICLES (المقالات الطبية)
   ===================================================== */
  function renderMedicalArticles(){
    const gridEl = document.getElementById('medicalArticlesGrid');
    if(!gridEl) return;
    gridEl.innerHTML = MEDICAL_ARTICLES.map(a=>`
      <div class="article-card" onclick="window.openArticle('${a.id}')" tabindex="0" onkeypress="if(event.key==='Enter')window.openArticle('${a.id}')" role="button">
        <div class="art-icon">${a.icon}</div>
        <h4>${a.title}</h4>
        <p>${a.summary}</p>
        <span class="read-more">اقرأ المزيد ←</span>
      </div>
    `).join('');
  }

  window.openArticle = function(id){
    const article = MEDICAL_ARTICLES.find(a=>a.id === id);
    if(!article) return;
    document.getElementById('articleTitle').textContent = article.title;
    document.getElementById('articleBody').innerHTML = article.body;
    document.getElementById('articleSource').textContent = article.source;
    document.getElementById('articleModal').classList.add('show');
  };

  window.closeArticle = function(){
    const modal = document.getElementById('articleModal');
    if(modal) modal.classList.remove('show');
  };

  const articleModal = document.getElementById('articleModal');
  if(articleModal){
    articleModal.addEventListener('click', e=>{
      if(e.target.id === 'articleModal') window.closeArticle();
    });
  }

  /* =====================================================
   14. TRUST STRIP (شريط الثقة)
   ===================================================== */
  function renderTrustStrip(){
    const el = document.getElementById('trustStrip');
    if(!el) return;
    el.innerHTML = TRUST_BADGES.map(b=>`
      <div class="trust-item">
        <div class="trust-icon">${b.icon}</div>
        <strong>${b.title}</strong>
        <span>${b.subtitle}</span>
      </div>
    `).join('');
  }

  /* =====================================================
   15. TESTIMONIALS SLIDER (آراء العملاء)
   ===================================================== */
  let testimonialIndex = 0;
  let testimonialTrack = null;

  function renderTestimonials(){
    const el = document.getElementById('testimonialsTrack');
    if(!el) return;
    el.innerHTML = TESTIMONIALS.map(t=>`
      <div class="testimonial-card">
        <div class="quote">"</div>
        <div class="stars">${'★'.repeat(t.rating)}${'☆'.repeat(5-t.rating)}</div>
        <p class="text">${t.text}</p>
        <div class="author">
          <div class="avatar">${t.initial}</div>
          <div class="author-info">
            <strong>${t.name}</strong>
            <span>${t.area}</span>
          </div>
        </div>
      </div>
    `).join('');
    testimonialTrack = el;
  }

  window.slideTestimonials = function(dir){
    if(!testimonialTrack) return;
    const card = testimonialTrack.querySelector('.testimonial-card');
    if(!card) return;
    const cardWidth = card.offsetWidth + 20;
    const maxIndex = Math.max(0, TESTIMONIALS.length - Math.floor(testimonialTrack.parentElement.offsetWidth / cardWidth));
    testimonialIndex = Math.max(0, Math.min(maxIndex, testimonialIndex + dir));
    testimonialTrack.style.transform = `translateX(${testimonialIndex * cardWidth}px)`;
  };

  /* =====================================================
   16. WORKING HOURS STATUS (حالة الفروع)
   ===================================================== */
  function updateBranchStatus(){
    document.querySelectorAll('[data-branch]').forEach(el=>{
      const branchKey = el.dataset.branch;
      const hours = D.WORKING_HOURS[branchKey];
      if(!hours) return;

      const now = new Date();
      const day = now.getDay();
      const hour = now.getHours() + now.getMinutes()/60;

      if(hours.closedDay !== null && day === hours.closedDay) {
        el.textContent = '🔴 إجازة أسبوعية';
        el.className = 'branch-status holiday';
        return;
      }

      let status = 'closed';

      if(day === 5) {
        if(hours.friday && hour >= hours.friday.open && hour < hours.friday.close) status = 'open';
      } else {
        const end = hours.satToThu.close === 24 ? 24 : hours.satToThu.close;
        if(hour >= hours.satToThu.open && hour < end) status = 'open';
      }

      el.textContent = status === 'open' ? '🟢 مفتوح الآن' : '🔴 مغلق';
      el.className = 'branch-status ' + status;
    });
  }
  updateBranchStatus();
  setInterval(updateBranchStatus, 5 * 60 * 1000);

  /* =====================================================
   17. NEW FEATURES (Counters, Scroll Reveal, Popup)
   ===================================================== */
  function initCounters() {
    const counters = document.querySelectorAll('.counter');
    const speed = 200;
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if(entry.isIntersecting) {
          const counter = entry.target;
          const updateCount = () => {
            const target = +counter.getAttribute('data-target');
            const count = +counter.innerText;
            const inc = target / speed;
            if (count < target) {
              counter.innerText = Math.ceil(count + inc);
              setTimeout(updateCount, 1);
            } else {
              counter.innerText = target;
            }
          };
          updateCount();
          obs.unobserve(counter);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(counter => observer.observe(counter));
  }

  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if(entry.isIntersecting) {
          entry.target.classList.add('active');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    reveals.forEach(reveal => observer.observe(reveal));
  }

  function initPopupOffer() {
    if(localStorage.getItem('teba_popup_shown') === 'yes') return;
    const showPopup = () => {
      const popup = document.getElementById('offerPopup');
      if (popup) {
        popup.classList.add('show');
        localStorage.setItem('teba_popup_shown', 'yes');
      }
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(showPopup, { timeout: 5000 });
    } else {
      setTimeout(showPopup, 3000);
    }
  }

  window.closePopupOffer = function() {
    const popup = document.getElementById('offerPopup');
    if(popup) popup.classList.remove('show');
  };

  /* =====================================================
   18. INIT (التشغيل النهائي)
   ===================================================== */
  document.getElementById('year') && (document.getElementById('year').textContent = new Date().getFullYear());
  buildCategories();
  bindViewToggle();
  renderPackages();
  renderTests();
  renderCart();
  renderMedicalArticles();
  renderTrustStrip();
  renderTestimonials();

  // تشغيل الميزات الإضافية
  initCounters();
  initScrollReveal();
  initPopupOffer();

  // ضبط القوائم الجانبية بناءً على حجم الشاشة
  if(window.innerWidth > 1000){
    sidebarRight.classList.remove('collapsed');
    sidebarLeft.classList.remove('collapsed');
  } else {
    sidebarRight.classList.add('collapsed');
    sidebarLeft.classList.add('collapsed');
  }

  if(location.hostname === 'localhost' || location.hostname === '127.0.0.1'){
    console.log('%c✅ معامل طيبة - app.js v123 loaded', 'color:#00ff7f;font-weight:bold');
  }

})();