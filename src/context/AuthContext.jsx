import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  apiFetch,
  clearAuthSession,
  readStoredToken,
  readStoredUser,
  storeAuthSession,
} from '../lib/authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStoredToken());
  const [user, setUser] = useState(() => readStoredUser());
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(readStoredToken()));

  const logout = useCallback(() => {
    clearAuthSession();
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || 'Login failed');
    }
    if (!body.token || !body.user?.username) {
      throw new Error('Invalid login response from server');
    }
    storeAuthSession(body.token, body.user);
    setToken(body.token);
    setUser({ username: body.user.username });
    return body.user;
  }, []);

  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/auth/me', { cache: 'no-store' }, { onUnauthorized: logout });
        if (!res.ok) {
          if (!cancelled) logout();
          return;
        }
        const body = await res.json();
        if (!cancelled && body?.user?.username) {
          setUser({ username: body.user.username });
        }
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  const authFetch = useCallback(
    (url, options = {}) => apiFetch(url, options, { onUnauthorized: logout }),
    [logout]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      bootstrapping,
      login,
      logout,
      authFetch,
    }),
    [token, user, bootstrapping, login, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
