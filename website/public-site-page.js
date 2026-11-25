import { loadPublishedSite } from './public-site.js';
import { getSupabaseClient } from '../core/supabase-client.js';
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
function bindSiteRequests(data){
 const dialog=$('siteRequestDialog'),form=$('siteRequestForm');if(!dialog||!form)return;
 const typeField=form.elements.namedItem('request_type'),packageField=form.elements.namedItem('package_id');
 const branchSelect=$('requestBranch'),status=$('requestStatus'),submit=$('requestSubmit');
 const branches=(data.branches||[]).filter(x=>x.show_on_site!==false&&x.is_published!==false);
 if(branchSelect)branchSelect.innerHTML='<option value="">لا يوجد تفضيل</option>'+branches.filter(x=>x.branch_id).map(x=>'<option value="'+esc(x.branch_id)+'">'+esc(x.public_name||'فرع المعمل')+'</option>').join('');
 const dateField=form.elements.namedItem('preferred_date');if(dateField)dateField.min=new Date().toISOString().slice(0,10);
 const open=(type,packageId='',title='')=>{form.reset();typeField.value=type;packageField.value=packageId; if(branchSelect)branchSelect.value='';status.hidden=true;status.textContent='';submit.disabled=false;submit.textContent='إرسال الطلب';$('siteRequestTitle').textContent=type==='package_inquiry'?'استفسار عن باقة '+title:'طلب سحب منزلي';dialog.showModal();};
 $('homeSamplingRequest')?.addEventListener('click',()=>open('home_sampling'));
 $('serviceHomeSamplingRequest')?.addEventListener('click',()=>open('home_sampling'));
 $('packageCards')?.addEventListener('click',event=>{const button=event.target.closest('[data-package-request]');if(button)open('package_inquiry',button.dataset.packageRequest,button.dataset.packageTitle||'');});
 $('closeSiteRequest')?.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();submit.disabled=true;status.hidden=true;
  const body={slug:data.tenant?.slug,request_type:typeField.value,package_id:packageField.value||null,full_name:form.elements.namedItem('full_name').value.trim(),phone:form.elements.namedItem('phone').value.trim(),branch_id:branchSelect?.value||null,preferred_date:dateField?.value||null,preferred_period:form.elements.namedItem('preferred_period').value||null,message:form.elements.namedItem('message').value.trim()||null};
  try{const {data:result,error}=await getSupabaseClient().functions.invoke('submit-site-request',{body});if(error)throw error;if(!result?.ok)throw new Error(result?.message||'تعذر إرسال الطلب.');status.textContent=result.message||'تم استلام طلبك. سيتواصل معك فريق المعمل.';status.dataset.kind='success';status.hidden=false;submit.textContent='تم استلام الطلب';}
  catch(error){status.textContent=error?.message||'تعذر إرسال الطلب الآن. حاول مرة أخرى لاحقًا.';status.dataset.kind='error';status.hidden=false;submit.disabled=false;}
 });
}
export function renderPublicSite(data){
 const tenant=data.tenant||{},settings=data.settings||{},content=settings.public_content||{},theme=settings.theme_json||{};
 const accent=/^#[0-9a-f]{6}$/i.test(theme.accent||theme.primary_color||'')?(theme.accent||theme.primary_color):'#16877f';
 const brandAccent=accent.toLowerCase()==='#16877f'?'#0a6847':accent;document.documentElement.style.setProperty('--accent',brandAccent);document.documentElement.style.setProperty('--teba',brandAccent);
 const name=content.lab_name||content.site_name||tenant.name||'المعمل';$('labName').textContent=name;$('footerName').textContent=name;$('brandTagline').textContent=content.tagline||'الموقع الإلكتروني الرسمي';
 $('heroTitle').textContent=content.hero_title||content.title||'صحتك تستحق رعاية أفضل';$('heroText').textContent=content.hero_description||content.description||'دقة في التحاليل، اهتمام بكل مريض، ونتائج تثق بها.';
 $('heroEyebrow').textContent=content.hero_eyebrow||'رعاية أدق تبدأ من هنا';$('heroCta').textContent=content.hero_button_text||'اكتشف خدماتنا';$('footerText').textContent=content.footer_text||content.contact_text||'نسعد بتواصلكم وزيارتكم في أحد فروعنا.';
 const logo=safeUrl(content.logo_url||content.logo_path);if(logo)$('logo').innerHTML='<img src="'+esc(logo)+'" alt="">';
 const heroImage=safeUrl(content.hero_image_url);const hero=$('hero');if(hero){hero.style.backgroundImage=heroImage?'linear-gradient(90deg,rgba(9,39,51,.92),rgba(9,39,51,.55)),url("'+heroImage+'")':'';hero.style.backgroundSize='cover';hero.style.backgroundPosition='center';}
 const phone=String(content.phone||'').replace(/[^0-9+]/g,'');const phoneDisplay=content.phone_display||content.phone||'';const wa=String(content.whatsapp||content.home_sampling_phone||'').replace(/\D/g,'');const waDisplay=content.whatsapp_display||content.whatsapp||'';
 const contact=$('contactCta');if(contact){contact.href=phone?'tel:'+phone:'#contact';contact.textContent=phoneDisplay?'اتصل بنا · '+phoneDisplay:'تواصل معنا';}const call=$('contactCall');if(call&&phone)call.href='tel:'+phone;
 const facebook=safeUrl(content.facebook_url);const facebookLink=$('facebookCta');if(facebookLink){facebookLink.hidden=!facebook;if(facebook)facebookLink.href=facebook;}
 const contactDetails=$('contactDetails');if(contactDetails){const parts=[];if(phone)parts.push('<a href="tel:'+esc(phone)+'">'+esc(phoneDisplay)+'</a>');if(wa)parts.push('<a href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener">واتساب '+esc(waDisplay)+'</a>');if(content.address)parts.push(esc(content.address));contactDetails.innerHTML=parts.join(' · ');}
 const hours=$('branchHoursPublic');if(hours)hours.innerHTML=String(content.branch_hours_text||'').split(/\r?\n/).map(esc).join('<br>');
 const announcementMessages=Array.isArray(content.announcement_messages)?content.announcement_messages.map(x=>String(x||'').trim()).filter(Boolean):[];const announcementBar=$('announcementBar');const announcementText=$('announcementText');if(announcementBar&&announcementText){announcementBar.hidden=content.announcement_enabled!==true||!announcementMessages.length;announcementText.replaceChildren();if(announcementMessages.length){const track=document.createElement('div');track.className='announcement-track';track.setAttribute('aria-live','polite');track.setAttribute('aria-atomic','true');announcementMessages.forEach((message,index)=>{const item=document.createElement('span');item.className='announcement-message';item.textContent=message;item.setAttribute('aria-hidden',index===0?'false':'true');track.appendChild(item);});announcementText.appendChild(track);if(announcementMessages.length>1&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){let current=0;let timer;const showNext=()=>{current=(current+1)%announcementMessages.length;track.style.transform='translateY(-'+(current*100/announcementMessages.length)+'%)';track.querySelectorAll('.announcement-message').forEach((item,index)=>item.setAttribute('aria-hidden',index===current?'false':'true'));};const start=()=>{if(!timer)timer=window.setInterval(showNext,4200);};const stop=()=>{if(timer){window.clearInterval(timer);timer=null;}};announcementBar.addEventListener('mouseenter',stop);announcementBar.addEventListener('mouseleave',start);announcementBar.addEventListener('focusin',stop);announcementBar.addEventListener('focusout',start);start();}}}
 $('patientAccess').href='../portal/index.html?lab='+encodeURIComponent(tenant.slug||'');const servicePortal=$('servicePortalLink'),footerPortal=$('footerPatientLink');if(servicePortal)servicePortal.href=$('patientAccess').href;if(footerPortal)footerPortal.href=$('patientAccess').href;
 $('employeeAccess').href='../app/index.html';$('ownerAccess').href='../app/index.html';
 $('year').textContent=new Date().getFullYear();$('aboutTextPublic').textContent=content.about_text||'نحرص على تقديم خدمة طبية دقيقة وتجربة مريحة لكل مريض.';$('servicesTextPublic').textContent=content.services_text||'خدمات معملية متكاملة مع اهتمام بجودة الخدمة وسهولة الوصول.';$('homeSamplingTextPublic').textContent=content.home_sampling_text||'يمكنك طلب سحب العينة من المنزل والتواصل مع فريق المعمل.';$('homeSamplingRequest').hidden=false;
 const allSections=data.sections||[];const sections=allSections.filter(x=>x.is_visible!==false&&x.is_published!==false).sort((a,b)=>(a.display_order||0)-(b.display_order||0));const sectionVisibility=new Map(allSections.map(x=>[x.section_key,x.is_visible!==false&&x.is_published!==false]));
 const builtIn={hero:'hero',about:'about',services:'services',home_sampling:'home_sampling',tests:'tests',offers:'offers',packages:'packages',articles:'articles',faqs:'faq',testimonials:'testimonials',branches:'branches'};
 const custom=sections.filter(x=>!builtIn[x.section_key]);
 const customNodes=new Map(custom.map(s=>{const c=s.content&&typeof s.content==='object'?s.content:{};const node=document.createElement('section');node.className='custom-section';node.innerHTML='<div class="wrap"><span class="eyebrow">'+esc(c.eyebrow||'')+'</span><h2>'+esc(s.title||c.title||'')+'</h2><p>'+esc(c.text||c.description||c.body||'')+'</p></div>';return [s.section_key,node]}));
 $('customSections')?.remove();
 const main=document.querySelector('main');
 const ordered=sections.map(s=>document.getElementById(builtIn[s.section_key])||customNodes.get(s.section_key)).filter(Boolean);
 for(const id of ['about','services','home_sampling','offers','packages','articles','faq','testimonials','branches']){const node=document.getElementById(id);if(node&&!ordered.includes(node))ordered.push(node)}
 const now=Date.now();const offers=(data.offers||[]).filter(x=>x.is_active!==false&&x.is_published!==false&&(!x.starts_at||new Date(x.starts_at).getTime()<=now)&&(!x.ends_at||new Date(x.ends_at).getTime()>=now));cards('offerCards',offers,x=>{const img=safeUrl(x.image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="'+esc(x.title)+'">':'')+'<span class="tag">عرض خاص</span><h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p>'+(x.discount_percent!=null?'<div class="price">خصم '+esc(x.discount_percent)+'%</div>':'')+'</article>'});
 const publicTests=(data.tests||[]).filter(x=>x.is_visible!==false&&x.is_published!==false).sort((a,b)=>(a.display_order||0)-(b.display_order||0));
 const testSearch=$('publicTestSearch'),testCount=$('publicTestCount');
 const renderTests=(term='')=>{
  const q=String(term||'').trim().toLocaleLowerCase('ar');
  const filtered=publicTests.filter(x=>[x.display_name,x.code,x.category,x.description].some(v=>String(v||'').toLocaleLowerCase('ar').includes(q)));
  if(testCount)testCount.textContent='عدد التحاليل: '+filtered.length+' من '+publicTests.length;
  cards('testCards',filtered,x=>'<article class="test-catalog-row"><div class="test-catalog-name"><strong>'+esc(x.display_name)+'</strong><small>'+esc(x.category||'تحاليل طبية')+(x.code?' · '+esc(x.code):'')+'</small>'+(x.description?'<p>'+esc(x.description)+'</p>':'')+'</div><div class="test-catalog-price">'+(x.display_price!=null&&x.display_price!==''?'<strong>'+esc(Number(x.display_price).toLocaleString('en-US'))+' جنيه</strong>':'<span>السعر غير محدد</span>')+'</div></article>');
 };
 renderTests();
 testSearch?.addEventListener('input',()=>renderTests(testSearch.value));
 const packages=(data.packages||[]).filter(x=>x.is_active!==false&&x.is_published!==false);cards('packageCards',packages,x=>{const img=safeUrl(x.image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="'+esc(x.title)+'">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.description||'')+'</p>'+(Array.isArray(x.included_tests)&&x.included_tests.length?'<p>'+esc(x.included_tests.join(' · '))+'</p>':'')+'<div class="price">'+(x.display_price!=null?esc(x.display_price)+' جنيه':'')+(x.old_price!=null?'<span class="old">'+esc(x.old_price)+' جنيه</span>':'')+'</div><button class="btn btn-outline package-request" type="button" data-package-request="'+esc(x.id)+'" data-package-title="'+esc(x.title)+'">استفسر عن الباقة</button></article>'});
 const articles=(data.articles||[]).filter(x=>x.is_published!==false);cards('articleCards',articles,x=>{const img=safeUrl(x.cover_image_path);return '<article class="card">'+(img?'<img src="'+esc(img)+'" alt="">':'')+'<h3>'+esc(x.title)+'</h3><p>'+esc(x.excerpt||'')+'</p>'+(x.body_json?.text?'<p>'+esc(x.body_json.text)+'</p>':'')+'</article>'});
 const faqs=(data.faqs||[]).filter(x=>x.is_published!==false);cards('faqCards',faqs,x=>card(x.question,x.answer));
 const testimonials=(data.testimonials||[]).filter(x=>x.is_published!==false);cards('testimonialCards',testimonials,x=>card(x.display_name||'عميل',x.content,'<div class="price">'+('★'.repeat(Math.max(0,Math.min(5,Number(x.rating)||0))))+'</div>'));
 const branches=(data.branches||[]).filter(x=>x.show_on_site!==false&&x.is_published!==false);cards('branchCards',branches,x=>{const map=safeUrl(x.public_map_link);return '<article class="card branch"><h3>'+esc(x.public_name||'فرع المعمل')+'</h3><p>'+esc(x.public_address||'')+'</p><p>'+esc(x.public_phone||'')+'</p>'+(map?'<a href="'+esc(map)+'" target="_blank" rel="noopener">عرض الموقع على الخريطة</a>':'')+'</article>'});
 bindSiteRequests(data);
 const contactSection=$('contact');if(contactSection&&!ordered.includes(contactSection))ordered.push(contactSection);
 ordered.forEach(node=>{
  const builtInKey=Object.keys(builtIn).find(key=>builtIn[key]===node.id);
  const key=builtInKey||node.id;
  if(sectionVisibility.has(key))node.hidden=!sectionVisibility.get(key);
 });
 const groups=[
  {title:'التحاليل الطبية والخدمات',ids:['services','tests']},
  {title:'الباقات والعروض',ids:['offers','packages']},
  {title:'الفروع ومواعيد العمل',ids:['branches']},
  {title:'السحب المنزلي',ids:['home_sampling']},
  {title:'من نحن ومعلومات تهمك',ids:['about','articles','testimonials','faq']},
  {title:'تواصل معنا',ids:['contact']}
 ];
 const groupNodes=groups.map(group=>({title:group.title,nodes:group.ids.map(id=>ordered.find(node=>node.id===id)).filter(node=>node&&!node.hidden)})).filter(group=>group.nodes.length);
 const customNodesList=ordered.filter(node=>node.classList.contains('custom-section')&&!groups.some(group=>group.ids.includes(node.id)));
 if(customNodesList.length)groupNodes.push({title:'معلومات إضافية',nodes:customNodesList});
 const accordion=$('accordionSections');
 if(accordion){
  accordion.replaceChildren();
  groupNodes.forEach((group,index)=>{
   const details=document.createElement('details');details.className='site-accordion-item';details.dataset.accordionIndex=String(index);
   const summary=document.createElement('summary');summary.className='site-accordion-trigger';
   summary.innerHTML='<span>'+esc(group.title)+'</span><span class="accordion-symbol" aria-hidden="true"></span>';
   const body=document.createElement('div');body.className='site-accordion-content';
   group.nodes.forEach(node=>{node.hidden=false;body.appendChild(node);});
   details.append(summary,body);accordion.appendChild(details);
   details.addEventListener('toggle',()=>{if(details.open)accordion.querySelectorAll('details[open]').forEach(other=>{if(other!==details)other.open=false;});});
  });
 }
 document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
  const id=link.getAttribute('href')?.slice(1);if(!id||id==='top')return;
  const target=$(id);const details=target?.closest('details.site-accordion-item');
  if(details){event.preventDefault();details.open=true;target.scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'','#'+id);}
 }));
 $('loading').hidden=true;$('site').hidden=false;document.title=name+' | الموقع الرسمي';
}
const params=new URLSearchParams(location.search),slug=params.get('lab')||((location.hostname==='teba-labs.github.io'&&location.pathname.startsWith('/teba-saas-demo/'))?'teba-labs':null);
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
