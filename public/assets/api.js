/**
 * The only place that talks to the API.
 *
 * Access tokens live in memory and die with the tab. The refresh token is kept
 * in localStorage so a reload does not log you out — it is the lesser of two
 * evils: an access token in storage is readable for its whole life, while a
 * refresh token is single-use and revoked the moment it is replayed.
 */

const REFRESH_KEY = 'mauapa.refresh';
const SLOW_MS = 2500;

let accessToken = null;
let refreshing = null;
const slowListeners = new Set();

export class ApiError extends Error {
  constructor(status, messages, body) {
    super(messages.join(', ') || `HTTP ${status}`);
    this.status = status;
    this.messages = messages;
    this.body = body;
  }
}

export const auth = {
  get token() {
    return accessToken;
  },
  get refreshToken() {
    return localStorage.getItem(REFRESH_KEY);
  },
  remember(pair) {
    accessToken = pair.accessToken;
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  },
  forget() {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Notifies the shell while a request is outliving the free tier's cold start. */
export function onSlow(listener) {
  slowListeners.add(listener);
  return () => slowListeners.delete(listener);
}

async function raw(path, options = {}, withAuth = true) {
  const slow = setTimeout(() => slowListeners.forEach((fn) => fn(true)), SLOW_MS);

  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(withAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(options.headers ?? {}),
      },
    });

    if (res.status === 204) return null;

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, body?.message ?? [], body);
    }
    return body;
  } finally {
    clearTimeout(slow);
    slowListeners.forEach((fn) => fn(false));
  }
}

/**
 * Trades the stored refresh token for a fresh pair.
 *
 * Concurrent 401s share one attempt. Firing several would rotate the token
 * repeatedly, and the API treats a replayed refresh token as theft — it revokes
 * every session for that user, so a burst of parallel requests would log the
 * person out rather than quietly recover.
 */
function refreshSession() {
  refreshing ??= (async () => {
    const token = auth.refreshToken;
    if (!token) throw new ApiError(401, ['Not signed in']);

    try {
      const pair = await raw(
        '/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken: token }) },
        false,
      );
      auth.remember(pair);
      return pair;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** One retry after a refresh; a second 401 means the session is genuinely over. */
export async function api(path, options = {}) {
  try {
    return await raw(path, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !auth.refreshToken) {
      throw error;
    }

    try {
      await refreshSession();
    } catch {
      auth.forget();
      throw error;
    }

    return raw(path, options);
  }
}

/** Public catalogue calls, which must not carry a token or trigger a refresh. */
export const publicApi = (path) => raw(path, {}, false);

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });

export const query = (params) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  return search.toString() ? `?${search}` : '';
};
