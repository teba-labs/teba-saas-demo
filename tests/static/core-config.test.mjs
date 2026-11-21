import assert from 'node:assert/strict';
import { APP_ENV, validateEnvironment } from '../../config/environment.js';

assert.equal(APP_ENV.name, 'primary');
assert.equal(APP_ENV.supabase.url, 'https://hgqwpykeazuzceeiumjg.supabase.co');
assert.equal(APP_ENV.supabase.url.includes('khjzoleiuiipyodpkieg'), false);
assert.ok(APP_ENV.supabase.publishableKey.startsWith('sb_publishable_'), 'Only the primary project publishable key may be configured in browser code.');
assert.equal(/service_role|secret/i.test(APP_ENV.supabase.publishableKey), false);

const result = validateEnvironment();
assert.equal(result.valid, true, `Primary configuration should validate: ${result.problems.join('; ')}`);

const legacyTestTarget = validateEnvironment({
  ...APP_ENV,
  supabase: {
    ...APP_ENV.supabase,
    url: 'https://khjzoleiuiipyodpkieg.supabase.co',
  },
});
assert.equal(legacyTestTarget.valid, false, 'The legacy TEST project must not replace the primary runtime target.');

const wrongHost = validateEnvironment({
  ...APP_ENV,
  supabase: {
    ...APP_ENV.supabase,
    url: 'https://example.supabase.co',
  },
});
assert.equal(wrongHost.valid, false, 'Unrecognized Supabase projects must be rejected.');

console.log('PASS: primary SaaS project URL and existing publishable browser key are configured; TEST project and unknown Supabase hosts are rejected.');
