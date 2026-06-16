import { AUTH_ORIGIN } from './auth-config.js';

const authListeners = new Set();
let currentUser = null;
let cachedToken = null;
let tokenExpiresAt = 0;
let refreshPromise = null;

function apiUrl(path) {
  const base = AUTH_ORIGIN || '';
  return `${base}${path}`;
}

function signInUrl() {
  const callback = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return apiUrl(`/auth/signin?callbackUrl=${encodeURIComponent(callback || '/rsvp/app/')}`);
}

function notifyAuthListeners() {
  authListeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

export function isAuthConfigured() {
  const host = window.location.hostname;
  return host === 'zipang.id' || host === 'localhost' || host === '127.0.0.1';
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (!isAuthConfigured()) {
      currentUser = null;
      cachedToken = null;
      tokenExpiresAt = 0;
      notifyAuthListeners();
      return null;
    }

    try {
      const res = await fetch(apiUrl('/api/auth/session'), { credentials: 'include' });
      const session = await res.json();
      const nextUser = session?.user?.email ? session.user : null;
      const changed = JSON.stringify(nextUser) !== JSON.stringify(currentUser);
      currentUser = nextUser;
      if (!currentUser) {
        cachedToken = null;
        tokenExpiresAt = 0;
      }
      if (changed) notifyAuthListeners();
      return currentUser;
    } catch {
      currentUser = null;
      cachedToken = null;
      tokenExpiresAt = 0;
      notifyAuthListeners();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function initAuth() {
  await refreshSession();

  window.addEventListener('focus', () => { refreshSession(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshSession();
  });
}

export function onAuthChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function isSignedIn() {
  return Boolean(currentUser?.email);
}

export async function getSessionToken() {
  if (!isSignedIn()) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) return cachedToken;

  try {
    const res = await fetch(apiUrl('/rsvp/sync-token'), { credentials: 'include' });
    if (res.status === 401) {
      await refreshSession();
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    cachedToken = data.token || null;
    tokenExpiresAt = Number(data.expiresAt) || 0;
    return cachedToken;
  } catch {
    return null;
  }
}

export function mountSignIn(target) {
  if (!target) return;
  target.innerHTML = '';
  const link = document.createElement('a');
  link.href = signInUrl();
  link.className = 'auth-google-btn';
  link.textContent = 'Continue with Google';
  target.appendChild(link);
}

export function mountUserButton(target) {
  if (!target) return;
  target.innerHTML = '';
  const link = document.createElement('a');
  link.href = apiUrl(`/api/auth/signout?callbackUrl=${encodeURIComponent('/rsvp/app/')}`);
  link.className = 'auth-signout-btn';
  link.textContent = 'Sign out';
  target.appendChild(link);
}

export function userLabel() {
  if (!currentUser) return '';
  return currentUser.name || currentUser.email || 'Account';
}