import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../auth/useAuth';
import { profileApi, type Profile } from './api';
import { ProfileContext, type ProfileContextValue } from './ProfileContext';

/** Loads the signed-in user's profile once for the whole portal. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { updateUser } = useAuth();
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const setProfile = useCallback(
    (next: Profile) => {
      setProfileState(next);
      updateUser(next.user); // keep name etc. in sync everywhere
    },
    [updateUser],
  );

  const reload = useCallback(async () => {
    try {
      setProfile(await profileApi.get());
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [setProfile]);

  useEffect(() => {
    let cancelled = false;
    profileApi
      .get()
      .then((p) => !cancelled && setProfile(p))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [setProfile]);

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, loading, error, setProfile, reload }),
    [profile, loading, error, setProfile, reload],
  );
  return <ProfileContext value={value}>{children}</ProfileContext>;
}
