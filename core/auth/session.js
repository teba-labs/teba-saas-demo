import { getSupabaseClient } from '../supabase-client.js';
import { getCachedOfflineUser, authenticateCachedOfflineUser, rememberOfflineUser, clearCachedOfflineUser } from '../../offline/device-identity.js';

const isOffline = () => globalThis.navigator?.onLine === false;

export async function getCurrentSession() {
  try {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw error;
    if (data.session) {
      if (!isOffline()) await rememberOfflineUser(data.session.user).catch(() => {});
      return data.session;
    }
    if (isOffline()) {
      const user = await getCachedOfflineUser();
      return user ? { user, offline: true, access_token: null, refresh_token: null } : null;
    }
    return null;
  } catch (error) {
    if (isOffline()) {
      const user = await getCachedOfflineUser().catch(() => null);
      if (user) return { user, offline: true, access_token: null, refresh_token: null };
    }
    throw error;
  }
}

export async function signInWithEmail(email, password) {
  if (isOffline()) {
    const user = await authenticateCachedOfflineUser(email, password);
    return { user, session: { user, offline: true, access_token: null, refresh_token: null }, offline: true };
  }
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) {
    if (/fetch|network|timeout|connection|offline/i.test(error.message || '')) {
      const user = await authenticateCachedOfflineUser(email, password);
      return { user, session: { user, offline: true, access_token: null, refresh_token: null }, offline: true };
    }
    throw error;
  }
  if (!data.user || !data.session) throw new Error('Sign-in did not return an authenticated session.');
  await rememberOfflineUser(data.user, password).catch(() => {});
  return data;
}

export async function signOut() {
  const client = getSupabaseClient();
  if (isOffline()) {
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    await clearCachedOfflineUser();
    return;
  }
  const { error } = await client.auth.signOut();
  if (error) throw error;
  await clearCachedOfflineUser();
}

export function onAuthStateChange(callback) {
  const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    callback({ event, session: session ?? null });
  });
  return () => data.subscription.unsubscribe();
}
