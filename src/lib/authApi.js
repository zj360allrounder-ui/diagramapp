const AUTH_TOKEN_KEY = 'zarus-diag-studio-auth-token-v1';
const AUTH_USER_KEY = 'zarus-diag-studio-auth-user-v1';

export function readStoredToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function readStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== 'string') return null;
    return { username: parsed.username };
  } catch {
    return null;
  }
}

export function storeAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ username: user.username }));
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * fetch wrapper that attaches JWT and surfaces 401 for the auth layer.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ onUnauthorized?: () => void }} [auth]
 */
export async function apiFetch(url, options = {}, auth = {}) {
  const token = readStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && typeof auth.onUnauthorized === 'function') {
    auth.onUnauthorized();
  }
  return res;
}
