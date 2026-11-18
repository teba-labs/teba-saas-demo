import assert from 'node:assert/strict';
import { APP_ENV, validateEnvironment } from '../../config/environment.js';

assert.equal(APP_ENV.supabase.url, 'https://hgqwpykeazuzceeiumjg.supabase.co');
assert.equal(APP_ENV.supabase.url.includes('khjzoleiuiipyodpkieg'), false);
assert.ok(APP_ENV.supabase.publishableKey.startsWith('sb_publishable_'), 'Only the TEST publishable key may be configured in browser code.');
assert.equal(/service_role|secret/i.test(APP_ENV.supabase.publishableKey), false);
const result = validateEnvironment();
assert.equal(result.valid, true, `TEST configuration should validate: ${result.problems.join('; ')}`);
console.log('PASS: TEST project URL and publishable browser key are configured; no secret key is present.');
