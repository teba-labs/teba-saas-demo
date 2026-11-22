import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const sql=await readFile(new URL('database/migrations/054_source_suggested_core_intervals.sql',root),'utf8');

test('core profile comparison intervals are sourced and remain locally unverified',()=>{
  assert.match(sql,/MAYO-CMP-113631/);
  assert.match(sql,/MAYO-TSH-8939/);
  assert.match(sql,/MAYO-SFEC-621385/);
  assert.match(sql,/MAYO-APROL-603308/);
  assert.match(sql,/reference_interval_status='local_verification_required'/);
  assert.doesNotMatch(sql,/reference_interval_status='verified_local'/);
  assert.match(sql,/reference_interval_source_type','external_source_suggested'/);
});

const pediatric=await readFile(new URL('database/migrations/080_cbc_profile_pediatric_source_intervals.sql',root),'utf8');
test('CBC profile receives sourced pediatric intervals without activating local flags',()=>{
  assert.match(pediatric,/t\.master_code='HEM_CBC'/);
  for(const code of ['RBC','HGB','HCT','MCV','RDW_CV','WBC','PLT'])assert.match(pediatric,new RegExp("p\\.parameter_code='"+code+"'"));
  assert.match(pediatric,/Mayo Clinic Laboratories pediatric age\/sex intervals are external comparison suggestions only/);
  assert.match(pediatric,/local_verification_required/);
  assert.doesNotMatch(pediatric,/reference_interval_status\s*=\s*'verified_local'/);
});
