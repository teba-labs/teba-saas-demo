import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../../modules/migration/price-importer.js',import.meta.url),'utf8');
const importer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const catalog=[
 {id:'test-cbc',code:'CBC',is_active:true},
 {id:'test-tsh',code:'TSH',is_active:true},
 {id:'test-glu',code:'GLU',is_active:true},
];
let writes=[];
const result=await importer.importNewBasePrices({
 tenantId:'tenant-a',
 records:[
  {test_code:'cbc',selling_price:'90',_rowNumber:2},
  {test_code:'TSH',selling_price:'100,50 ج.م',_rowNumber:3},
  {test_code:'GLU',selling_price:'',_rowNumber:4},
 ],
 listCatalog:async()=>catalog,
 listExistingPrices:async()=>[
  {tenant_id:'tenant-a',test_id:'test-cbc',branch_id:null,is_current:true},
  // A branch override does not replace or block creation of a missing base price.
  {tenant_id:'tenant-a',test_id:'test-tsh',branch_id:'branch-a',is_current:true},
 ],
 savePrice:async args=>{writes.push(args);return{created:true,price:{id:'price-'+args.testId}};}
});
assert.equal(result.created.length,1);
assert.equal(result.created[0].code,'TSH');
assert.equal(result.created[0].sellingPrice,100.5);
assert.equal(result.skipped.length,2);
assert.equal(writes.length,1);
assert.equal(writes[0].tenantId,'tenant-a');
assert.equal(writes[0].testId,'test-tsh');

// Decimal fractions remain valid despite binary floating-point representation.
const fractional=await importer.importNewBasePrices({
 tenantId:'tenant-a',records:[{test_code:'GLU',selling_price:0.29}],
 listCatalog:async()=>catalog,listExistingPrices:async()=>[],
 savePrice:async args=>({created:true,price:{id:'fractional-'+args.testId}})
});
assert.equal(fractional.created[0].sellingPrice,0.29);

// Existing base prices are never overwritten and retries are idempotent.
const retry=await importer.importNewBasePrices({
 tenantId:'tenant-a',records:[{test_code:'TSH',selling_price:100.5}],
 listCatalog:async()=>catalog,
 listExistingPrices:async()=>[{test_id:'test-tsh',branch_id:null,is_current:true}],
 savePrice:async()=>{throw new Error('must not write');}
});
assert.equal(retry.created.length,0);
assert.equal(retry.skipped.length,1);

// Duplicate codes, malformed prices, and unresolved catalog references fail before writes.
let preflightWrites=0;
await assert.rejects(()=>importer.importNewBasePrices({
 tenantId:'tenant-a',records:[{test_code:'TSH',selling_price:10},{test_code:'tsh',selling_price:20}],
 listCatalog:async()=>catalog,listExistingPrices:async()=>[],
 savePrice:async()=>{preflightWrites++;}
}),/كود مكرر/);
await assert.rejects(()=>importer.importNewBasePrices({
 tenantId:'tenant-a',records:[{test_code:'TSH',selling_price:'12,3456'}],
 listCatalog:async()=>catalog,listExistingPrices:async()=>[],
 savePrice:async()=>{preflightWrites++;}
}),/تنسيق السعر|السعر غير صالح/);
await assert.rejects(()=>importer.importNewBasePrices({
 tenantId:'tenant-a',records:[{test_code:'UNKNOWN',selling_price:20}],
 listCatalog:async()=>catalog,listExistingPrices:async()=>[],
 savePrice:async()=>{preflightWrites++;}
}),/لا تطابق تحاليل نشطة/);
assert.equal(preflightWrites,0);

// Zero is a valid configured price; partial failures remain visible for safe retry.
const partial=await importer.importNewBasePrices({
 tenantId:'tenant-a',
 records:[{test_code:'GLU',selling_price:0},{test_code:'TSH',selling_price:80}],
 listCatalog:async()=>catalog,listExistingPrices:async()=>[],
 savePrice:async({testId})=>{if(testId==='test-tsh')throw new Error('network');return{created:true,price:{id:'zero-price'}};}
});
assert.equal(partial.created.length,1);
assert.equal(partial.created[0].sellingPrice,0);
assert.equal(partial.failed.length,1);
console.log('PASS: base price import is insert-only, tenant-scoped, branch-override-safe, duplicate-safe and retry-safe.');
