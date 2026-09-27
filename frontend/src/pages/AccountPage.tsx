import { useAuth } from '../features/auth/useAuth';

/** Minimal signed-in landing page; the full dashboard arrives in Step 3. */
export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <section className="card">
      <h1>Welcome, {user.name}</h1>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Phone</dt>
        <dd>{user.phone ?? '—'}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
      </dl>
    </section>
  );
}
