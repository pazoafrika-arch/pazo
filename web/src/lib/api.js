/**
 * API client.
 *
 * Holds the access token in memory and the refresh token in localStorage.
 * When a request comes back 401 the client transparently refreshes once and
 * replays the original request, so a expiring token never interrupts the user.
 * Concurrent 401s share a single refresh promise rather than stampeding.
 */

/**
 * The API lives on the same origin in every real deployment: nginx proxies
 * /api, and on a platform the Node process serves both. A relative path is
 * therefore the correct default, and it is what the Vite dev proxy expects
 * too. VITE_API_URL only needs setting when the API is on another host.
 */
const BASE = import.meta.env.VITE_API_URL || '/api/v1';
const REFRESH_KEY = 'pazo.refresh';
const USER_KEY = 'pazo.user';

let accessToken = null;
let refreshPromise = null;
let onUnauthenticated = null;

export const setUnauthenticatedHandler = (fn) => {
  onUnauthenticated = fn;
};

export const getAccessToken = () => accessToken;

export function setSession({ access_token, refresh_token, user }) {
  if (access_token) accessToken = access_token;
  try {
    if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage can be unavailable in private mode; the session still works */
  }
}

export function clearSession() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function cachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const hasRefreshToken = () => {
  try {
    return !!localStorage.getItem(REFRESH_KEY);
  } catch {
    return false;
  }
};

/** An error carrying the server's message so forms can show it verbatim. */
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function refreshAccessToken() {
  const token = (() => {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  })();
  if (!token) return null;

  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error('refresh failed');
        accessToken = json.data.access_token;
        if (json.data.user) {
          try {
            localStorage.setItem(USER_KEY, JSON.stringify(json.data.user));
          } catch {
            /* ignore */
          }
        }
        return accessToken;
      })
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, signal, raw = false, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(
      'Cannot reach the Pazo server. Check your connection and try again.',
      0,
      null,
    );
  }

  // One transparent refresh-and-replay on an expired token.
  if (res.status === 401 && retry && hasRefreshToken()) {
    const fresh = await refreshAccessToken();
    if (fresh) return request(path, { method, body, signal, raw, retry: false });
    if (onUnauthenticated) onUnauthenticated();
  }

  if (raw) {
    if (!res.ok) throw new ApiError('That download is not available', res.status, null);
    return res;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const message = json?.error || `Request failed (${res.status})`;
    if (res.status === 401 && onUnauthenticated) onUnauthenticated();
    throw new ApiError(message, res.status, json?.details || null);
  }
  return json.data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body: body ?? {} }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body: body ?? {} }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  raw: (path, opts) => request(path, { ...opts, raw: true }),
  refresh: refreshAccessToken,
  base: BASE,
};

/** Turn a query object into a search string, dropping empty values. */
export function qs(params = {}) {
  const usable = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all',
  );
  if (!usable.length) return '';
  return `?${new URLSearchParams(usable).toString()}`;
}

/**
 * Download a file from an authenticated endpoint. The browser cannot send the
 * bearer header on a plain link, so the bytes are fetched then saved via a
 * temporary object URL.
 */
export async function downloadFile(path, filename) {
  const res = await api.raw(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
