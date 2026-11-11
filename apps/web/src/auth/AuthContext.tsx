import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { LoginResponse, SessionUser } from '@suboard/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, authEvents } from '../api/client';
import { qk } from '../api/hooks';

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  /** Returns the user, or a challenge token when a second factor is required. */
  login: (email: string, password: string) => Promise<{ user: SessionUser } | { challengeToken: string }>;
  verifyMfa: (challengeToken: string, code: string) => Promise<SessionUser>;
  /** Replace the cached session user after a server-side change (MFA, preferences). */
  /** Sign in with a passkey stored on this device (or a nearby phone / security key). */
  passkeyLogin: () => Promise<SessionUser>;
  setUser: (user: SessionUser) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Drop every cached query except the session itself (cached data may be sensitive and belongs
 * to the previous identity). The `me` query is updated in place rather than removed, so the
 * provider's observer stays subscribed and re-renders with the new identity.
 */
function resetCache(qc: QueryClient, user: SessionUser | null) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.me[0] });
  qc.setQueryData(qk.me, user);
}

async function fetchMe(): Promise<SessionUser | null> {
  try {
    return (await api<{ user: SessionUser | null }>('/auth/me')).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, staleTime: 60_000, retry: 1 });

  useEffect(() => {
    // Session expired elsewhere: drop all cached data (it may be sensitive) and show login.
    const onUnauthorized = () => resetCache(qc, null);
    const onPwRequired = () => void qc.invalidateQueries({ queryKey: qk.me });
    authEvents.addEventListener('unauthorized', onUnauthorized);
    authEvents.addEventListener('password-change-required', onPwRequired);
    return () => {
      authEvents.removeEventListener('unauthorized', onUnauthorized);
      authEvents.removeEventListener('password-change-required', onPwRequired);
    };
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<LoginResponse>('/auth/login', 'POST', { email, password });
      if (res.mfaRequired) return { challengeToken: res.challengeToken };
      resetCache(qc, res.user);
      return { user: res.user };
    },
    [qc],
  );

  const verifyMfa = useCallback(
    async (challengeToken: string, code: string) => {
      const res = await api<LoginResponse>('/auth/mfa/verify', 'POST', { challengeToken, code });
      if (res.mfaRequired) throw new Error('unexpected MFA response');
      resetCache(qc, res.user);
      return res.user;
    },
    [qc],
  );

  const passkeyLogin = useCallback(async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const { challengeId, options } = await api<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/auth/passkey/login/options', 'POST', {});
    const response = await startAuthentication({ optionsJSON: options });
    const res = await api<LoginResponse>('/auth/passkey/login/verify', 'POST', { challengeId, response });
    if (res.mfaRequired) throw new Error('unexpected MFA response');
    resetCache(qc, res.user);
    return res.user;
  }, [qc]);

  const setUser = useCallback((user: SessionUser) => qc.setQueryData(qk.me, user), [qc]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', 'POST');
    } finally {
      resetCache(qc, null);
    }
  }, [qc]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: qk.me });
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({ user: me.data ?? null, loading: me.isPending, login, verifyMfa, passkeyLogin, setUser, logout, refresh }),
    [me.data, me.isPending, login, verifyMfa, passkeyLogin, setUser, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
