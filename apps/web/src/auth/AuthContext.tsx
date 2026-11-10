import type { SessionUser } from '@suboard/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, authEvents } from '../api/client';
import { qk } from '../api/hooks';

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
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
      const { user } = await api<{ user: SessionUser }>('/auth/login', 'POST', { email, password });
      resetCache(qc, user);
      return user;
    },
    [qc],
  );

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
    () => ({ user: me.data ?? null, loading: me.isPending, login, logout, refresh }),
    [me.data, me.isPending, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
