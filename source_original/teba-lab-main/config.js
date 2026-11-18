// =====================================================
// TEBA LABS - Configuration File (v150 - Dynamic & Force Color)
// =====================================================

// قراءة البيانات من ذاكرة المتصفح، ولو مش موجودة نستخدم القيم الافتراضية
const _currentTenantId = localStorage.getItem('teba_tenant_id') || "0981e62c-c33d-46c4-8919-2f9fbb0946f6";
const _currentTenantName = localStorage.getItem('teba_tenant_name') || "معمل التحاليل الطبية"; // اسم افتراضي عام
const _currentLogoUrl = localStorage.getItem('teba_logo_url') || "";
const _currentPrimaryColor = localStorage.getItem('teba_primary_color') || "#0a6847";
const _currentPhone = localStorage.getItem('teba_phone') || "";
const _currentWhatsapp = localStorage.getItem('teba_whatsapp') || "";

const TEBA_CONFIG = {
    tenant: { 
        id: _currentTenantId, 
        name: _currentTenantName,
        logo: _currentLogoUrl,
        primaryColor: _currentPrimaryColor
    },
    lab: {
        name: _currentTenantName, 
        nameEn: "TEBA LABS", 
        doctor: "د/ أحمد طه أبوندا",
        phone: _currentPhone, 
        whatsapp: _currentWhatsapp, 
        address: "شبين القناطر، القليوبية",
        portalUrl: "https://teba-labs.github.io/teba-lab/index.html" 
    },
    supabase: {
        url: "https://khjzoleiuiipyodpkieg.supabase.co",
        key: "sb_publishable_2Q7SPvruXJar3gvOxtvl5w_p4CVDfcU"
    },
    settings: { 
        sessionTimeout: 2 * 60 * 60 * 1000 
    }
};

// تطبيق الهوية فوراً وبقوة عشان نمنع اللون إنه يرجع أخضر
document.addEventListener("DOMContentLoaded", () => {
    // 1. حقن كود CSS إجباري عشان نغصب المتصفح يغير اللون في كل الصفحات
    const style = document.createElement('style');
    style.innerHTML = `
        :root { 
            --primary: ${TEBA_CONFIG.tenant.primaryColor} !important; 
            --primary-hover: ${TEBA_CONFIG.tenant.primaryColor} !important;
            --primary-gradient: linear-gradient(135deg, ${TEBA_CONFIG.tenant.primaryColor}, #085a3d) !important;
        }
        /* إجبار العناصر الأساسية على أخذ اللون */
        .btn-login, .btn-save, .nav-btn.sync, .app-icon-box {
            background-color: ${TEBA_CONFIG.tenant.primaryColor} !important;
        }
        .header-title, .brand-info, h1.dyn-lab-name {
            color: ${TEBA_CONFIG.tenant.primaryColor} !important;
        }
    `;
    document.head.appendChild(style);

    // 2. تحديث عنوان الصفحة
    if (TEBA_CONFIG.lab.name) {
        document.title = TEBA_CONFIG.lab.name;
    }
    
    // 3. تحديث الأسماء في كل الصفحات
    document.querySelectorAll('.dyn-lab-name').forEach(el => el.textContent = TEBA_CONFIG.lab.name);
    if(document.getElementById('loginLabName')) document.getElementById('loginLabName').textContent = "🔬 " + TEBA_CONFIG.lab.name;
    if(document.getElementById('desktopLabName')) document.getElementById('desktopLabName').textContent = "مرحباً، " + TEBA_CONFIG.lab.name;
    
    // 4. تحديث اللوجو
    if(TEBA_CONFIG.tenant.logo) {
        document.querySelectorAll('.dyn-logo').forEach(logoImg => {
            logoImg.src = TEBA_CONFIG.tenant.logo;
            logoImg.style.display = 'block';
        });
    }
});