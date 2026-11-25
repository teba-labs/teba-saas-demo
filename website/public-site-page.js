import { loadPublishedSite } from './public-site.js';
import { getCmsSettings, listCmsItems, cmsCollectionNames } from './cms-repository.js';
import { loadMyTenantContext } from '../core/tenant/context.js';
const $=id=>document.getElementById(id);
const accessDialog=$('accessDialog');
$('portalLink')?.addEventListener('click',()=>accessDialog?.showModal());
$('closeAccessDialog')?.addEventListener('click',()=>accessDialog?.close());
accessDialog?.addEventListener('click',event=>{if(event.target===accessDialog)accessDialog.close();});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=v=>{try{const u=new URL(String(v),location.href);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
function cards(id,items,html){const node=$(id);if(!node)return;const section=node.closest('section');if(section)section.hidden=!items.length;node.innerHTML=items.map(html).join('');}
function card(title,desc,extra=''){return '<article class="card"><h3>'+esc(title)+'</h3><p>'+esc(desc)+'</p>'+extra+'</article>'}
export function renderPublicSite(data){
 const tenant=data.tenant||{},settings=data.settings||{},content=settings.public_content||{},theme=settings.theme_json||{};
 const accent=/^#[0-9a-f]{6}$/i.test(theme.accent||theme.primary_color||'')?(theme.accent||theme.primary_color):'#16877f';
 const brandAccent=accent.toLowerCase()==='#16877f'?'#0a6847':accent;document.documentElement.style.setProperty('--accent',brandAccent);document.documentElement.style.setProperty('--teba',brandAccent);
 const name=content.lab_name||content.site_name||tenant.name||'المعمل';$('labName').textContent=name;$('footerName').textContent=name;$('brandTagline').textContent=content.tagline||'الموقع الإلكتروني الرسمي';
 $('heroTitle').textContent=content.hero_title||content.title||'تحاليل دقيقة… واهتمام يليق بك';$('heroText').textContent=content.hero_description||content.description||'نقدم خدمات التحاليل الطبية وفق معايير جودة دقيقة، مع اهتمام بتجربة المريض وسهولة الوصول إلى النتائج.';
 $('heroEyebrow').textContent=content.hero_eyebrow||'رعاية أدق تبدأ من هنا';$('heroCta').textContent=content.hero_button_text||'اكتشف خدماتنا';$('footerText').textContent=content.footer_text||content.contact_text||'نسعد بتواصلكم وزيارتكم في أحد فروعنا.';
 const logo=safeUrl(content.logo_url||content.logo_path);if(logo)$('logo').innerHTML='<img src="'+esc(logo)+'" alt="">';
 const heroImage=safeUrl(content.hero_image_url);const hero=$('hero');if(hero){hero.style.backgroundImage=heroImage?'linear-gradient(90deg,rgba(9,39,51,.92),rgba(9,39,51,.55)),url("'+heroImage+'")':'';hero.style.backgroundSize='cover';hero.style.backgroundPosition='center';}
 const phone=String(content.phone||'').replace(/[^0-9+]/g,'');const phoneDisplay=content.phone_display||content.phone||'';const wa=String(content.whatsapp||content.home_sampling_phone||'').replace(/\D/g,'');const waDisplay=content.whatsapp_display||content.whatsapp||'';
 const contact=$('contactCta');if(contact){contact.href=phone?'tel:'+phone:'#contact';contact.textContent=phoneDisplay?'اتصل بنا · '+phoneDisplay:'تواصل معنا';}const call=$('contactCall');if(call&&phone)call.href='tel:'+phone;
 const facebook=safeUrl(content.facebook_url);const fb=$('contactFacebook');if(fb&&facebook){fb.href=facebook;fb.hidden=false;}const facebookLink=$('facebookCta');if(facebookLink){facebookLink.hidden=!facebook;if(facebook)facebookLink.href=facebook;}
 const contactDetails=$('contactDetails');if(contactDetails){const parts=[];if(phone)parts.push('<a href="tel:'+esc(phone)+'">'+esc(phoneDisplay)+'</a>');if(wa)parts.push('<a href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener">واتساب '+esc(waDisplay)+'</a>');if(content.address)parts.push(esc(content.address));contactDetails.innerHTML=parts.join(' · ');}
 const hours=$('branchHoursPublic');if(hours)hours.innerHTML=String(content.branch_hours_text||'').split(/\r?\n/).map(esc).join('<br>');
 const announcementMessages=Array.isArray(content.announcement_messages)?content.announcement_messages.filter(Boolean):[];const announcementBar=$('announcementBar');const announcementText=$('announcementText');if(announcementBar&&announcementText){announcementBar.hidden=content.announcement_enabled!==true||!announcementMessages.length;announcementText.textContent=announcementMessages.join('  •  ');}
 $('patientAccess').href='../portal/index.html?lab='+encodeURIComponent(tenant.slug||'');const servicePortal=$('servicePortalLink'),footerPortal=$('footerPatientLink');if(servicePortal)servicePortal.href=$('patientAccess').href;if(footerPortal)footerPortal.href=$('patientAccess').href;
 $('employeeAccess').href='../app/index.html';$('ownerAccess').href='../app/index.html';
 $('year').textContent=new Date().getFullYear();$('aboutTextPublic').textContent=content.about_text||'نحرص على تقديم خدمة طبية دقيقة وتجربة مريحة لكل مريض.';$('servicesTextPublic').textContent=content.services_text||'خدمات معملية متكاملة مع اهتمام بجودة الخدمة وسهولة الوصول.';$('homeSamplingTextPublic').textContent=content.home_sampling_text||'يمكنك طلب سحب العينة من المنزل والتواصل مع فريق المعمل.';const samplingPhone=String(content.home_sampling_phone||content.whatsapp||'').replace(/\D/g,'');$('homeSamplingLink').href=samplingPhone?'https://wa.me/'+samplingPhone+'?text='+encodeURIComponent('مرحبًا، أريد الاستفسار عن خدمة السحب المنزلي.'):'#contact';$('homeSamplingLink').hidden=!samplingPhone;
 const allSections=data.sections||[];const sections=allSections.filter(x=>x.is_visible!==false&&x.is_published!==false).sort((a,b)=>(a.display_order||0)-(b.display_order||0));const sectionVisibility=new Map(allSections.map(x=>[x.section_key,x.is_visible!==false&&x.is_published!==false]));
 const builtIn={hero:'hero',about:'about',services:'services',home_sampling:'home_sampling',offers:'offers',packages:'packages',articles:'articles',faqs:'faq',testimonials:'testimonials',branches:'branches'};
 const custom=sections.filter(x=>!builtIn[x.section_key]&&x.section_key!=='tests');
 const customNodes=new Map(custom.map(s=>{const c=s.content&&typeof s.content==='object'?s.content:{};const node=document.createElement('section');node.className='custom-section';node.innerHTML='<div class="wrap"><span class="eyebrow">'+esc(c.eyebrow||'')+'</span><h2>'+esc(s.title||c.title||'')+'</h2><p>'+esc(c.text||c.description||c.body||'')+'</p></div>';return [s.section_key,node]}));
 $('customSections').remove();
 const main=document.querySelector('main');
 const ordered=sections.filter(s=>s.section_key!=='tests').map(s=>document.getElementById(builtIn[s.section_key])||customNodes.get(s.section_key)).filter(Boolean);
 for(const id of ['hero','about','services','home_sampling','offers','packages','articles','faq','testimonials','branches']){const node=document.getElementById(id);if(node&&!ordered.includes(node))ordered.push(node)}
 const now=Date.now();const offers=(data.offers||[]).filter(x=>x.is_active!==false&&x.is_published!==false&&(!x.starts_at||new Date(x.starts_at).getTime()<=now)&&(!x.ends_at||new Date(x.ends_at).getTime()>=now));cards('offerCards',offers,x=>'<article class="card"><span class="tag">عرض خاص</span><h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p>'+(x.discount_percent!=null?'<div class="price">خصم '+esc(x.discount_percent)+'%</div>':'')+'</article>');
 const packages=(data.packages||[]).filter(x=>x.is_active!==false&&x.is_published!==false);cards('packageCards',packages,x=>{const img=safeUrl(x.image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="'+esc(x.title)+'">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p>'+(Array.isArray(x.included_tests)&&x.included_tests.length?'<p>'+esc(x.included_tests.join(' · '))+'</p>':'')+'<div class="price">'+(x.display_price!=null?esc(x.display_price)+' جنيه':'')+(x.old_price!=null?'<span class="old">'+esc(x.old_price)+' جنيه</span>':'')+'</div></article>'});
 const articles=(data.articles||[]).filter(x=>x.is_published!==false);cards('articleCards',articles,x=>{const img=safeUrl(x.cover_image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.excerpt||'')+'</p>'+(x.body_json?.text?'<p>'+esc(x.body_json.text)+'</p>':'')+'</article>'});
 const faqs=(data.faqs||[]).filter(x=>x.is_published!==false);cards('faqCards',faqs,x=>card(x.question,x.answer));
 const testimonials=(data.testimonials||[]).filter(x=>x.is_published!==false);cards('testimonialCards',testimonials,x=>card(x.display_name||'عميل',x.content,'<div class="price">'+('★'.repeat(Math.max(0,Math.min(5,Number(x.rating)||0))))+'</div>'));
 const branches=(data.branches||[]).filter(x=>x.show_on_site!==false&&x.is_published!==false);cards('branchCards',branches,x=>{const map=safeUrl(x.public_map_link);return '<article class="card branch"><h3>'+esc(x.public_name||'فرع المعمل')+'</h3><p>'+esc(x.public_address||'')+'</p><p>'+esc(x.public_phone||'')+'</p>'+(map?'<a href="'+esc(map)+'" target="_blank" rel="noopener">عرض الموقع على الخريطة</a>':'')+'</article>'});
 ordered.forEach(node=>{if(node.classList.contains('custom-section'))node.hidden=false;else{const key=Object.keys(builtIn).find(k=>builtIn[k]===node.id);const configured=key&&sectionVisibility.has(key)?!sectionVisibility.get(key):false;node.hidden=node.hidden||configured;}main.appendChild(node)});
 $('loading').hidden=true;$('site').hidden=false;document.title=name+' | الموقع الرسمي';
}
const params=new URLSearchParams(location.search),slug=params.get('lab');
try{
 if(!slug)throw new Error('لم يتم تحديد رمز المعمل في رابط الموقع.');
 let data;
 if(params.get('preview')==='1'){
  const context=await loadMyTenantContext();
  const tenant=(context.tenants||[]).find(x=>x.slug===slug&&x.accountType==='owner');
  if(!tenant)throw new Error('المعاينة الخاصة متاحة لمالك المعمل فقط.');
  const [settings,...collections]=await Promise.all([getCmsSettings({tenantId:tenant.id}),...cmsCollectionNames.map(collection=>listCmsItems({tenantId:tenant.id,collection}))]);
  data={tenant,settings,...Object.fromEntries(cmsCollectionNames.map((key,i)=>[key,collections[i]]))};
 }else{
  data=await loadPublishedSite(slug);
  if(!data)throw new Error('الموقع غير منشور أو رمز المعمل غير صحيح.');
 }
 renderPublicSite(data);
}catch(e){$('loading').hidden=true;$('error').style.display='block';$('error').textContent=e.message||'تعذر تحميل الموقع.';}
