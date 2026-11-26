/**
 * Taiba Smart Lab — primary runtime environment.
 * Target: the existing Taiba SaaS Supabase project.
 * Keep the current URL and publishable key unchanged to preserve the live connection.
 * Never place service_role or other secret keys in browser code.
 */
const PRIMARY_SUPABASE_URL = 'https://hgqwpykeazuzceeiumjg.supabase.co';
const PRIMARY_PROJECT_REF = 'hgqwpykeazuzceeiumjg';

export const APP_ENV = Object.freeze({
  name: 'primary',
  // Temporary development policy: skip commercial offline entitlements only.
  // Authentication, tenant/branch membership and RLS remain enforced.
  offlineLicenseMode: 'development-bypass',
  supabase: Object.freeze({
    url: PRIMARY_SUPABASE_URL,
    publishableKey: 'sb_publishable_7FzS_dDxTF7bObMLJfI_sQ_6ac410OO', // Existing primary project's publishable browser key.
  }),
  timezone: 'Africa/Cairo',
  currency: 'EGP',
  session: Object.freeze({
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }),
});

export function validateEnvironment(config = APP_ENV) {
  const problems = [];
  if (!config.supabase?.url?.startsWith('https://')) {
    problems.push('Supabase URL must use HTTPS.');
  }
  if (config.supabase?.url !== PRIMARY_SUPABASE_URL) {
    problems.push(`This runtime must point to the designated primary Supabase project (${PRIMARY_PROJECT_REF}).`);
  }
  if (!config.supabase?.publishableKey?.trim()) {
    problems.push('Primary Supabase publishable key has not been configured.');
  }
  if (/service_role|secret/i.test(config.supabase?.publishableKey || '')) {
    problems.push('A secret/service_role key must never be used in browser code.');
  }
  return { valid: problems.length === 0, problems };
}
