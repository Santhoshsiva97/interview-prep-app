import { createContext } from 'react';
import type { Profile } from './api';

export interface ProfileContextValue {
  profile: Profile | null;
  loading: boolean;
  error: string;
  /** Stores a fresh profile returned by any /me endpoint. */
  setProfile: (profile: Profile) => void;
  reload: () => Promise<void>;
}

export const ProfileContext = createContext<ProfileContextValue | null>(null);
