import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../dashboard/owner-financial-repository.js', import.meta.url), 'utf8');
const importPath = source.match(/from\s*['"]([^'"]*supabase-client\.js)['"]/);
assert.ok(importPath, 'owner financial repository must import the Supabase client');
const resolved = new URL(importPath[1], 'https://teba-labs.github.io/teba-saas-demo/dashboard/owner-financial-repository.js');
assert.equal(
  resolved.href,
  'https://teba-labs.github.io/teba-saas-demo/core/supabase-client.js',
  'Supabase client import must stay inside the GitHub Pages project path'
);
console.log('PASS: owner financial repository resolves Supabase client inside /teba-saas-demo/core/.');
