import { RequireAuth } from '../../features/auth/RequireAuth';
import { ProfileProvider } from '../../features/profile/ProfileProvider';
import { AppShell } from './AppShell';
import { PORTAL_NAV } from './portalNav';

/** Candidate portal (FRD §4.2): any signed-in user. */
export function PortalLayout() {
  return (
    <RequireAuth>
      <ProfileProvider>
        <AppShell nav={PORTAL_NAV} homePath="/dashboard" label="Portal" />
      </ProfileProvider>
    </RequireAuth>
  );
}
