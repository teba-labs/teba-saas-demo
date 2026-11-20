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
