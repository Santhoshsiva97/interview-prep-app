import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  refreshAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
} from '../../lib/api';
import { authApi, type AuthSession, type User } from './api';
import { AuthContext, type AuthContextValue } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Restore the session from the HttpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshAccessToken<AuthSession>()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    setSessionExpiredHandler(() => setUser(null));
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, []);

  const startSession = useCallback((session: AuthSession) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, startSession, logout }),
    [user, initializing, startSession, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
