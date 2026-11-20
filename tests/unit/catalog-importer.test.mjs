import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../../modules/migration/catalog-importer.js',import.meta.url),'utf8');
const importer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let saved=[];
const listExisting=async()=>[{code:'CBC'},{code:'ALT'}];
const saveTest=async({tenantId,test})=>{saved.push({tenantId,...test});return{id:'new-'+test.code};};
const result=await importer.importNewCatalogTests({tenantId:'tenant-a',records:[
 {test_code:'cbc',test_name:'CBC existing',_rowNumber:2},
 {test_code:'TSH',test_name:'TSH',_rowNumber:3}
],listExisting,saveTest});
assert.equal(result.created.length,1);
assert.equal(result.created[0].code,'TSH');
assert.equal(result.skipped.length,1);
assert.equal(saved.length,1);
assert.equal(saved[0].tenantId,'tenant-a');
let writes=0;
await assert.rejects(()=>importer.importNewCatalogTests({tenantId:'tenant-a',records:[
 {test_code:'X',test_name:'X'},{test_code:'x',test_name:'duplicate'}
],listExisting,saveTest:async()=>{writes++;}}),/كود مكرر/);
assert.equal(writes,0);
await assert.rejects(()=>importer.importNewCatalogTests({tenantId:'tenant-a',records:[
 {test_code:'',test_name:'missing code',_rowNumber:9}
],listExisting,saveTest:async()=>{writes++;}}),/صف 9/);
assert.equal(writes,0);
const partial=await importer.importNewCatalogTests({tenantId:'tenant-a',records:[
 {test_code:'GLU',test_name:'Glucose'},{test_code:'UREA',test_name:'Urea'}
],listExisting:async()=>[],saveTest:async({test})=>{if(test.code==='UREA')throw Error('network');return{id:'1'};}});
assert.equal(partial.created.length,1);
assert.equal(partial.failed.length,1);
console.log('PASS: insert-only catalog import skips existing codes, validates duplicates before writes, and reports partial failures.');
