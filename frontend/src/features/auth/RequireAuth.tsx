import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { UserRole } from './api';
import { useAuth } from './useAuth';

interface RequireAuthProps {
  children: ReactNode;
  /** Optional role restriction (super_admin always passes, as on the API). */
  roles?: UserRole[];
}

/** Route wrapper: redirects to /login when signed out. */
export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return <p aria-busy="true">Loading…</p>;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && user.role !== 'super_admin' && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
