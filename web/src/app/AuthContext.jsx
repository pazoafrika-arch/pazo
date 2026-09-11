import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  cachedUser,
  clearSession,
  hasRefreshToken,
  setSession,
  setUnauthenticatedHandler,
} from '../lib/api.js';

const AuthContext = createContext(null);

export const HOME_FOR_ROLE = {
  individual: '/app',
  institution: '/institution',
  business_owner: '/business',
  admin: '/admin',
  super_admin: '/admin',
};

export function AuthProvider({ children }) {
  // Start from the cached user so a refresh does not flash the login screen.
  const [user, setUser] = useState(() => (hasRefreshToken() ? cachedUser() : null));
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async ({ notifyServer = true } = {}) => {
    if (notifyServer) {
      try {
        const token = localStorage.getItem('pazo.refresh');
        if (token) await api.post('/auth/logout', { refresh_token: token });
      } catch {
        /* signing out locally matters more than the server call succeeding */
      }
    }
    clearSession();
    setUser(null);
  }, []);

  // Restore the session on first load by exchanging the refresh token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasRefreshToken()) {
        setReady(true);
        return;
      }
      const token = await api.refresh();
      if (cancelled) return;
      if (!token) {
        clearSession();
        setUser(null);
        setReady(true);
        return;
      }
      try {
        const data = await api.get('/auth/me');
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) {
          clearSession();
          setUser(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client calls this when a refresh finally fails.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      clearSession();
      setUser(null);
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  const signIn = useCallback(async (identifier, password) => {
    const data = await api.post('/auth/login', { identifier, password });
    setSession(data);
    setUser(data.user);
    return data;
  }, []);

  /** Used after signup, which already returns a full session. */
  const adoptSession = useCallback((data) => {
    setSession(data);
    setUser(data.user);
    return data;
  }, []);

  const patchUser = useCallback((patch) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('pazo.user', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      signIn,
      signOut,
      adoptSession,
      patchUser,
      isAdmin: user?.role === 'admin' || user?.role === 'super_admin',
      isSuperAdmin: user?.role === 'super_admin',
      home: user ? HOME_FOR_ROLE[user.role] || '/' : '/',
    }),
    [user, ready, signIn, signOut, adoptSession, patchUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
