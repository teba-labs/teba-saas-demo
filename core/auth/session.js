import { getSupabaseClient } from '../supabase-client.js';

export async function getCurrentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function signInWithEmail(email, password) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw error;
  if (!data.user || !data.session) throw new Error('Sign-in did not return an authenticated session.');
  return data;
}

export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    callback({ event, session: session ?? null });
  });
  return () => data.subscription.unsubscribe();
}
