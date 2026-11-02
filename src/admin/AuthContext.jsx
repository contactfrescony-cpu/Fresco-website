import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {})
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/** Holds the signed-in staff user. status: 'loading' | 'signed-in' | 'signed-out' | 'unavailable'. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          setUser((await response.json()).user);
          setStatus('signed-in');
        } else {
          setStatus(response.status === 503 ? 'unavailable' : 'signed-out');
        }
      })
      .catch(() => { if (!cancelled) setStatus('unavailable'); });
    return () => { cancelled = true; };
  }, []);

  /**
   * `loginId` is the user's login ID. Returns null on success, or an error code:
   * invalid_credentials | pending_approval | account_disabled | rate_limited | db_unavailable | network.
   */
  const login = useCallback(async (loginId, password) => {
    try {
      const { ok, data } = await postJson('/api/auth/login', { login: loginId, password });
      if (!ok) return data.error || 'invalid_credentials';
      setUser(data.user);
      setStatus('signed-in');
      return null;
    } catch {
      return 'network';
    }
  }, []);

  const logout = useCallback(async () => {
    try { await postJson('/api/auth/logout'); } catch { /* signed out locally either way */ }
    setUser(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { postJson };

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
