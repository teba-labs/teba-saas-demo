import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const html=fs.readFileSync(path.join(root,'app/reception.html'),'utf8');
const script=fs.readFileSync(path.join(root,'assets/js/reception.js'),'utf8');
const repo=fs.readFileSync(path.join(root,'modules/reception/repository.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'database/migrations/016_branch_outstanding_balances.sql'),'utf8');

test('reception displays branch outstanding balances and allows later collection',()=>{
  for(const id of ['balancePanel','refreshBalances','balancesList']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(script,/listBranchOutstandingBalances/);
  assert.match(script,/recordPayment\(\{tenantId:state\.tenant\.id,branchId:state\.branch\.id/);
  assert.match(script,/paymentMethod:card\.querySelector\('\.balance-method'\)\.value/);
  assert.match(script,/amount>remaining/);
  assert.match(script,/if\(!state\.workday\)/);
});

test('outstanding balances are calculated server-side across all payments for branch visits',()=>{
  assert.match(repo,/rpc\('list_branch_outstanding_balances'/);
  assert.match(repo,/need\(branchId, 'branchId'\)/);
  assert.match(migration,/private\.can_access_branch\(p_tenant_id, p_branch_id\)/);
  assert.match(migration,/left join public\.payments py on py\.tenant_id = vb\.tenant_id and py\.visit_id = vb\.visit_id/);
  assert.match(migration,/having .* > 0\.005/);
  assert.match(migration,/grant execute on function public\.list_branch_outstanding_balances.*to authenticated/);
});

test('follow-up payment outbox always receives an explicit branch scope',()=>{
  assert.match(repo,/recordPayment\(\{ tenantId, branchId, visitId/);
  assert.match(repo,/enqueueOperation\(\{ tenantId, branchId, entityType: 'payment'/);
});
