import assert from 'node:assert/strict';
import { buildExpenseBreakdown } from '../../modules/dashboard/expense-breakdown.js';

const rows=buildExpenseBreakdown({
 branches:[{id:'b1',name:'الجعافرة'},{id:'b2',name:'بهتيم'}],
 ledgerRows:[
  {id:'l1',branch_id:'b1',source_type:'expense',source_id:'e1',direction:'outflow',amount:100},
  {id:'l2',branch_id:'b1',source_type:'expense',source_id:'e2',direction:'outflow',amount:50},
  {id:'l3',branch_id:'b2',source_type:'expense',source_id:'e3',direction:'outflow',amount:75},
  {id:'l4',branch_id:'b2',source_type:'manual',source_id:null,direction:'outflow',amount:10},
  {id:'l5',branch_id:'b1',source_type:'payment',source_id:'p1',direction:'inflow',amount:900},
 ],
 expenseRows:[
  {id:'e1',category_id:'c1'},
  {id:'e2',category_id:'c1'},
  {id:'e3',category_id:'c2'}
 ],
 categoryRows:[{id:'c1',name:'كيماويات'},{id:'c2',name:'مرتبات'}]
});
assert.equal(rows.length,3);
assert.deepEqual(rows.find(x=>x.branchId==='b1'&&x.categoryId==='c1'),{
 branchId:'b1',branchName:'الجعافرة',categoryId:'c1',categoryName:'كيماويات',count:2,amount:150
});
assert.equal(rows.find(x=>x.branchId==='b2'&&x.categoryId==='c2').amount,75);
assert.equal(rows.find(x=>x.categoryName==='حركة خارجة أخرى').amount,10);
assert.equal(rows.reduce((sum,x)=>sum+x.amount,0),235);
const missing=buildExpenseBreakdown({ledgerRows:[{branch_id:'b1',source_type:'expense',source_id:'missing',direction:'outflow',amount:5}]});
assert.equal(missing[0].categoryName,'مصروف غير مرتبط ببند');
console.log('PASS: live expense breakdown groups ledger outflows by branch/category and reconciles totals without counting inflows.');
