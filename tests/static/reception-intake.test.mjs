import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const page=fs.readFileSync(path.join(root,'app/reception.html'),'utf8');
const script=fs.readFileSync(path.join(root,'assets/js/reception.js'),'utf8');
const repo=fs.readFileSync(path.join(root,'modules/reception/repository.js'),'utf8');

test('reception page is Arabic RTL and includes patient, visit, catalog and billing workflow',()=>{
  assert.match(page,/lang="ar" dir="rtl"/);
  for(const id of ['patientSearch','patientName','visitNumber','catalogList','discount','initialPayment','initialPaymentMethod','createVisit']) assert.match(page,new RegExp(`id="${id}"`));
});
test('reception resolves authenticated tenant and branch context and requires open workday',()=>{
  assert.match(script,/loadMyTenantContext/);
  assert.match(script,/getOpenWorkday\(/);
  assert.match(script,/if\(!state\.workday\|\|!state\.staff\.length\)/);
});
test('patient search and creation are branch-scoped',()=>{
  assert.match(script,/findPatients\(\{tenantId:state\.tenant\.id,branchId:state\.branch\.id/);
  assert.match(script,/createPatient\(\{tenantId:state\.tenant\.id,branchId:state\.branch\.id/);
  assert.match(repo,/\.eq\('tenant_id', tenantId\)\.eq\('branch_id', branchId\)/);
});
test('visit uses database price snapshots and creates billing from actual selected test prices',()=>{
  assert.match(script,/createVisitIntake\(/);
  assert.match(script,/testIds:\[\.\.\.state\.selected\]/);
  assert.match(script,/discountAmount:discount,initialPayment:paid/);
  assert.match(script,/paymentMethod:\$\('initialPaymentMethod'\)\.value/);
  assert.match(page,/value="bank_transfer"/);
  assert.match(page,/value="wallet"/);
});
test('intake validates patient, unique visit number input, test selection and payment bounds',()=>{
  assert.match(script,/if\(!state\.patient\)/);
  assert.match(script,/visitNumber=\$\('visitNumber'\)\.value\|\|makeCode\('V'\)/);
  assert.match(script,/if\(!state\.selected\.size\)/);
  assert.match(script,/paid>gross-discount/);
});
test('patient search safely handles user input without compound filter syntax',()=>{
  assert.match(repo,/safeTerm = term\.replace\(/);
  assert.match(repo,/\.ilike\('full_name'/);
  assert.doesNotMatch(repo,/\.or\(/);
});

test('visit intake RPC is atomic, tenant/branch scoped and derives invoice totals from database snapshots',()=>{
  const sql=fs.readFileSync(path.join(root,'database/migrations/004_atomic_visit_intake.sql'),'utf8');
  assert.match(sql,/security definer/);
  assert.match(sql,/private\.can_access_branch\(p_tenant_id, p_branch_id\)/);
  assert.match(sql,/insert into public\.visit_tests/);
  assert.match(sql,/sum\(price_snapshot\)/);
  assert.match(sql,/insert into public\.visit_billing/);
  assert.match(sql,/insert into public\.payments/);
  assert.match(sql,/grant execute .* to authenticated/);
  assert.match(sql,/revoke all .* from public, anon/);
});
