import { loadPublishedSite } from './public-site.js';
import { getCmsSettings, listCmsItems, cmsCollectionNames } from './cms-repository.js';
import { loadMyTenantContext } from '../core/tenant/context.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=v=>{try{const u=new URL(String(v),location.href);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
function cards(id,items,html){const node=$(id),section=node.closest('section');if(section)section.hidden=!items.length;node.innerHTML=items.map(html).join('');}
function card(title,desc,extra=''){return '<article class="card"><h3>'+esc(title)+'</h3><p>'+esc(desc)+'</p>'+extra+'</article>'}
export function renderPublicSite(data){
 const tenant=data.tenant||{},settings=data.settings||{},content=settings.public_content||{},theme=settings.theme_json||{};
 const accent=/^#[0-9a-f]{6}$/i.test(theme.accent||theme.primary_color||'')?(theme.accent||theme.primary_color):'#16877f';
 document.documentElement.style.setProperty('--accent',accent);
 const name=content.lab_name||content.site_name||tenant.name||'المعمل';$('labName').textContent=name;$('footerName').textContent=name;
 $('heroTitle').textContent=content.hero_title||content.title||'تحاليل دقيقة… واهتمام يليق بك';$('heroText').textContent=content.hero_description||content.description||'نقدم خدمات التحاليل الطبية وفق معايير جودة دقيقة، مع اهتمام بتجربة المريض وسهولة الوصول إلى النتائج.';
 $('heroEyebrow').textContent=content.hero_eyebrow||'رعاية أدق تبدأ من هنا';$('heroCta').textContent=content.hero_button_text||'اكتشف خدماتنا';$('footerText').textContent=content.footer_text||content.contact_text||'نسعد بتواصلكم وزيارتكم في أحد فروعنا.';
 const logo=safeUrl(content.logo_url||content.logo_path);if(logo)$('logo').innerHTML='<img src="'+esc(logo)+'" alt="">';
 $('portalLink').href='../portal/index.html?lab='+encodeURIComponent(tenant.slug||'');
 $('year').textContent=new Date().getFullYear();
 const allSections=data.sections||[];const sections=allSections.filter(x=>x.is_visible!==false&&x.is_published!==false).sort((a,b)=>(a.display_order||0)-(b.display_order||0));const sectionVisibility=new Map(allSections.map(x=>[x.section_key,x.is_visible!==false&&x.is_published!==false]));
 const builtIn={hero:'hero',offers:'offers',packages:'packages',tests:'tests',articles:'articles',faqs:'faq',testimonials:'testimonials',branches:'branches'};
 const custom=sections.filter(x=>!builtIn[x.section_key]);
 $('customSections').innerHTML=custom.map(s=>{const c=s.content&&typeof s.content==='object'?s.content:{};return '<section class="custom-section"><div class="wrap"><span class="eyebrow">'+esc(c.eyebrow||'')+'</span><h2>'+esc(s.title||c.title||'')+'</h2><p>'+esc(c.text||c.description||c.body||'')+'</p></div></section>'}).join('');
 const main=document.querySelector('main'),customNode=$('customSections');
 const ordered=sections.map(s=>document.getElementById(builtIn[s.section_key])||(s.section_key==='custom'?customNode:null)).filter(Boolean);
 for(const id of ['hero','offers','packages','tests','articles','faq','testimonials','branches']){const node=document.getElementById(id);if(node&&!ordered.includes(node))ordered.push(node)}
 if(custom.length&&!ordered.includes(customNode))ordered.push(customNode);
 ordered.forEach(node=>{if(node===customNode)node.hidden=!custom.length;else{const key=Object.keys(builtIn).find(k=>builtIn[k]===node.id);node.hidden=key&&sectionVisibility.has(key)?!sectionVisibility.get(key):false;}main.appendChild(node)});
 const offers=(data.offers||[]).filter(x=>x.is_active!==false&&x.is_published!==false);cards('offerCards',offers,x=>'<article class="card"><span class="tag">عرض خاص</span><h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p>'+(x.discount_percent!=null?'<div class="price">خصم '+esc(x.discount_percent)+'%</div>':'')+'</article>');
 const packages=(data.packages||[]).filter(x=>x.is_active!==false&&x.is_published!==false);cards('packageCards',packages,x=>{const img=safeUrl(x.image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="'+esc(x.title)+'">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p><div class="price">'+(x.display_price!=null?esc(x.display_price)+' جنيه':'')+(x.old_price!=null?'<span class="old">'+esc(x.old_price)+' جنيه</span>':'')+'</div></article>'});
 const tests=(data.tests||[]).filter(x=>x.is_visible!==false&&x.is_published!==false);cards('testCards',tests,x=>'<article class="card"><h3>'+esc(x.display_name||x.code)+'</h3><p>'+esc(x.description||x.category||'')+'</p>'+(x.display_price!=null?'<div class="price">'+esc(x.display_price)+' جنيه</div>':'')+'</article>');
 const articles=(data.articles||[]).filter(x=>x.is_published!==false);cards('articleCards',articles,x=>{const img=safeUrl(x.cover_image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.excerpt||'')+'</p></article>'});
 const faqs=(data.faqs||[]).filter(x=>x.is_published!==false);cards('faqCards',faqs,x=>card(x.question,x.answer));
 const testimonials=(data.testimonials||[]).filter(x=>x.is_published!==false);cards('testimonialCards',testimonials,x=>card(x.display_name||'عميل',x.content,'<div class="price">'+('★'.repeat(Math.max(0,Math.min(5,Number(x.rating)||0))))+'</div>'));
 const branches=(data.branches||[]).filter(x=>x.show_on_site!==false&&x.is_published!==false);cards('branchCards',branches,x=>{const map=safeUrl(x.public_map_link);return '<article class="card branch"><h3>'+esc(x.public_name||'فرع المعمل')+'</h3><p>'+esc(x.public_address||'')+'</p><p>'+esc(x.public_phone||'')+'</p>'+(map?'<a href="'+esc(map)+'" target="_blank" rel="noopener">عرض الموقع على الخريطة</a>':'')+'</article>'});
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
