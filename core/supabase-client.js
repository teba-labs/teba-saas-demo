/** Supabase client factory. Loaded as an ES module in the browser. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { APP_ENV, validateEnvironment } from '../config/environment.js';

let singleton;

export function getSupabaseClient() {
  if (singleton) return singleton;
  const check = validateEnvironment();
  if (!check.valid) {
    throw new Error(`Taiba Smart Lab configuration incomplete: ${check.problems.join(' ')}`);
  }
  singleton = createClient(APP_ENV.supabase.url, APP_ENV.supabase.publishableKey, {
    auth: APP_ENV.session,
    global: { headers: { 'X-Client-Info': 'taiba-smart-lab-neutral/1.0' } },
  });
  return singleton;
}
