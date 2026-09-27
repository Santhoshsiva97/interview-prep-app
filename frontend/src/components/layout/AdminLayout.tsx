import { RequireAuth } from '../../features/auth/RequireAuth';
import { ProfileProvider } from '../../features/profile/ProfileProvider';
import { AppShell } from './AppShell';
import { ADMIN_NAV, STAFF_ROLES } from './portalNav';

/** Admin console (FRD §4.3): staff only; nav items are filtered by role. */
export function AdminLayout() {
  return (
    <RequireAuth roles={STAFF_ROLES}>
      <ProfileProvider>
        <AppShell
          nav={ADMIN_NAV}
          homePath="/admin"
          label="Admin"
          badge="Admin"
        />
      </ProfileProvider>
    </RequireAuth>
  );
}
