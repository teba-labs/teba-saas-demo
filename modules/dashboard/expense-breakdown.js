/** Build a live expense breakdown from ledger movements and their tenant-scoped expense records. */
export function buildExpenseBreakdown({ledgerRows=[],expenseRows=[],categoryRows=[],branches=[]}={}){
 const expenses=new Map((expenseRows||[]).map(row=>[row.id,row]));
 const categories=new Map((categoryRows||[]).map(row=>[row.id,row.name]));
 const branchNames=new Map((branches||[]).map(row=>[row.id,row.name]));
 const grouped=new Map();
 for(const ledger of ledgerRows||[]){
  if(ledger?.direction!=='outflow')continue;
  const expense=ledger.source_type==='expense'?expenses.get(ledger.source_id):null;
  let categoryId=null,categoryName;
  if(ledger.source_type!=='expense'){
   categoryId='other:'+String(ledger.source_type||'unknown');
   categoryName='حركة خارجة أخرى';
  }else if(!expense){
   categoryName='مصروف غير مرتبط ببند';
  }else if(!expense.category_id){
   categoryName='مصروف غير مصنف';
  }else{
   categoryId=expense.category_id;
   categoryName=categories.get(categoryId)||'بند غير معروف';
  }
  const branchId=ledger.branch_id??null;
  const key=String(branchId??'')+'|'+String(categoryId??categoryName);
  const amount=Number(ledger.amount??0);
  if(!Number.isFinite(amount))continue;
  const item=grouped.get(key)||{
   branchId,branchName:branchNames.get(branchId)||'فرع غير معروف',
   categoryId,categoryName,count:0,amount:0
  };
  item.count+=1;item.amount+=amount;grouped.set(key,item);
 }
 return [...grouped.values()].sort((a,b)=>a.branchName.localeCompare(b.branchName,'ar')||b.amount-a.amount||a.categoryName.localeCompare(b.categoryName,'ar'));
}
