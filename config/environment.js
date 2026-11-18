/**
 * Taiba Smart Lab — environment configuration (neutral template)
 * Target: TEST Supabase project only.
 * Never place service_role or other secret keys in browser code.
 * TEST project publishable key is configured below; never use a secret key here.
 */
export const APP_ENV = Object.freeze({
  name: 'development',
  supabase: Object.freeze({
    url: 'https://hgqwpykeazuzceeiumjg.supabase.co',
    publishableKey: 'sb_publishable_7FzS_dDxTF7bObMLJfI_sQ_6ac410OO', // TEST project publishable key; public browser key only.
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
  if (!config.supabase?.url?.startsWith('https://')) problems.push('Supabase URL must use HTTPS.');
  if (!config.supabase?.url?.includes('hgqwpykeazuzceeiumjg.supabase.co')) {
    problems.push('This development build must point to the approved TEST Supabase project.');
  }
  if (!config.supabase?.publishableKey?.trim()) problems.push('TEST Supabase publishable key has not been configured.');
  if (/service_role|secret/i.test(config.supabase?.publishableKey || '')) {
    problems.push('A secret/service_role key must never be used in browser code.');
  }
  return { valid: problems.length === 0, problems };
}
