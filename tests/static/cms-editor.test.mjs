import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const html=fs.readFileSync(path.join(root,'app/cms-editor.html'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/js/cms-editor.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/css/cms-editor.css'),'utf8');

test('website studio covers all tenant-owned website collections',()=>{
 for(const name of ['tests','packages','articles','faqs','testimonials','offers','branches']) assert.match(js,new RegExp(`${name}:\\{title:`));
 assert.match(js,/cmsCollectionNames/);assert.match(js,/renderSections/);
 assert.match(js,/listCmsItems/);assert.match(js,/saveCmsItem/);assert.match(js,/setCmsItemVisibility/);
});
test('website studio requires owner membership and uses tenant-scoped repository methods',()=>{
 assert.match(js,/accountType==='owner'/);assert.match(js,/tenantId:state\.tenant\.id/);
 assert.match(js,/getCmsSettings/);assert.match(js,/saveCmsSettings/);
});
test('public website content and prices are independent from operational records',()=>{
 assert.match(html,/منفصلة عن الفواتير وبيانات التشغيل/);
 assert.match(html,/السعر المعروض للزائر/);
 assert.match(js,/is_published/);assert.doesNotMatch(js,/from\(['"]patients|from\(['"]visits|from\(['"]test_results/);
});
test('website studio escapes database content before rendering labels',()=>{
 assert.match(js,/esc=v=>String\(v\?\?''\)/);assert.match(js,/esc\(titleOf\(x,kind\)\)/);
});
test('website studio uses guided fields instead of JSON editing',()=>{
 assert.match(html,/التحاليل والأسعار المعروضة/);assert.match(html,/نبذة عن المعمل/);
 assert.match(html,/السحب المنزلي/);assert.match(js,/item\.body_json=\{text:item\.article_text/);
 assert.doesNotMatch(html,/publicContent|themeJson|محتوى القسم \(JSON\)/);
 assert.match(js,/الرابط المختصر/);assert.match(js,/نسبة الخصم يجب/);
});
test('website studio assets and navigation controls are present',()=>{
 assert.match(html,/cms-editor\.css/);assert.match(html,/cms-editor\.js/);
 for(const id of ['tenantSelect','previewLink','togglePublish','brandName','heroTitle','list-tests','form-tests','sectionManager','portalUrl']) assert.match(html,new RegExp(`id="${id}"`));
 for(const view of ['identity','home','tests','packages','branches','content','sections','portal']) assert.match(html,new RegExp(`data-view="${view}"`));
 assert.ok(css.length>1000);
});
test('CMS image upload remains tenant-scoped, type and size limited, and uses the public site-assets bucket',()=>{
 const repository=fs.readFileSync(path.join(root,'website/cms-repository.js'),'utf8');
 assert.match(repository,/uploadCmsAsset/);assert.match(repository,/tenantId}\/cms\//);
 assert.match(repository,/tenant-site-assets/);assert.match(repository,/image\/webp/);
 assert.match(repository,/10 \* 1024 \* 1024/);assert.match(repository,/upsert: false/);
});
test('package and article images are uploaded to the tenant CMS folder and saved to their own public fields',()=>{
 assert.match(js,/type==='file'/);assert.match(js,/uploadCmsAsset\(\{tenantId:state\.tenant\.id,file\}\)/);
 assert.match(js,/kind==='packages'\|\|kind==='offers'\?'image_path':'cover_image_path'/);
 assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
});
test('public branch details are separate from operational branch fields',()=>{
 assert.match(js,/public_address/);assert.match(js,/public_phone/);assert.match(js,/الفرع التشغيلي المرتبط \(للتعريف فقط\)/);
 assert.match(js,/branch_id/);
});
test('website section order and visibility are persisted and rendered',()=>{
 assert.match(js,/display_order:i\*10/);assert.match(js,/is_visible:row\.is_visible/);
 const page=fs.readFileSync(path.join(root,'website/public-site-page.js'),'utf8');
 assert.match(page,/ordered\.forEach/);assert.match(page,/sectionVisibility/);
});

test('CMS edit forms repopulate saved input values and local datetime fields',()=>{
 assert.match(js,/valueAttr=tag==='input'\?' value="'\+esc\(v\)\+'"'/);
 assert.match(js,/type==='datetime-local'&&v/);
 assert.match(js,/toISOString\(\)\.slice\(0,16\)/);
});
