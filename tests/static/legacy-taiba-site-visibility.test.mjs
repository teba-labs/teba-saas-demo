import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261125000200_fix_legacy_taiba_test_visibility.sql'),'utf8');
test('legacy core flag is not misused as public visibility',()=>{
 assert.match(migration,/t\.slug='teba-labs'/);
 assert.match(migration,/s\.code like 'TEBA-%'/);
 assert.match(migration,/set is_visible=true/);
 assert.match(migration,/old site's filter/);
 assert.doesNotMatch(migration,/is_published\s*=/);
 assert.doesNotMatch(migration,/delete from/i);
});
