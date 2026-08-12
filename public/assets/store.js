/**
 * Session state and hash routing.
 *
 * Hash routes rather than the History API: the app is served as a static file
 * by the same process that serves the API, and a path-based router would need
 * every unknown path rewritten to index — which would also swallow genuine 404s
 * from the API.
 */

import { auth, get } from './api.js';

const listeners = new Set();

export const session = {
  user: null,
  get role() {
    return this.user?.role ?? null;
  },
  get signedIn() {
    return this.user !== null;
  },
  /** The shop an owner or staff member is currently running. */
  shop: null,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach((fn) => fn());
}

/* ── routing ─────────────────────────────────────────────────────────── */

export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, search] = raw.split('?');
  const parts = path.split('/').filter(Boolean);

  return {
    name: parts[0] || '',
    params: parts.slice(1),
    query: Object.fromEntries(new URLSearchParams(search ?? '')),
  };
}

export function go(path) {
  const next = path.startsWith('#') ? path : `#/${path}`;
  if (location.hash === next) {
    notify();
  } else {
    location.hash = next;
  }
}

export function startRouter(render) {
  window.addEventListener('hashchange', render);
  subscribe(render);
}

/* ── session bootstrap ───────────────────────────────────────────────── */

/**
 * Restores a session from the stored refresh token.
 *
 * `/auth/me` with no access token returns 401, which the api layer turns into
 * a refresh attempt — so this single call both proves the token still works and
 * fetches the profile.
 */
export async function restore() {
  if (!auth.refreshToken) return null;

  try {
    session.user = await get('/auth/me');
    return session.user;
  } catch {
    auth.forget();
    session.user = null;
    return null;
  }
}

export function signOut() {
  auth.forget();
  session.user = null;
  session.shop = null;
  go('masuk');
}

/** Where a freshly signed-in person should land, given who they are. */
export function homeFor(user) {
  return user?.role === 'CUSTOMER' ? 'cari' : 'papan';
}
