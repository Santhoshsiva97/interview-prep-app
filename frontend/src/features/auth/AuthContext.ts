import { createContext } from 'react';
import type { AuthSession, User } from './api';

export interface AuthContextValue {
  user: User | null;
  /** True until the initial session restore (via refresh cookie) finishes. */
  initializing: boolean;
  /** Stores a session returned by login / verify-email. */
  startSession: (session: AuthSession) => void;
  /** Replaces the cached user (e.g. after a profile edit changes the name). */
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
