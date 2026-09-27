import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { FormAlert, FormField } from '../../components/form/FormField';
import btn from '../../components/ui/Button.module.css';
import {
  adminApi,
  formatDate,
  ROLE_LABELS,
  type AdminUserSummary,
  type StaffRole,
} from '../../features/admin/api';
import {
  RoleBadge,
  StatusBadge,
} from '../../features/admin/components/UserBadges';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

const STAFF_ROLE_OPTIONS: { value: StaffRole; hint: string }[] = [
  { value: 'editor', hint: 'Creates and edits questions and content' },
  { value: 'support', hint: 'Looks up users and handles tickets' },
  { value: 'admin', hint: 'Manages candidates, exams, plans and settings' },
];

/** Super admin: create staff accounts and review the team (FRD §4.3). */
export function AdminStaffPage() {
  const [staff, setStaff] = useState<AdminUserSummary[] | null>(null);
  const [listError, setListError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listUsers({ scope: 'staff', sort: 'name', pageSize: 100 })
      .then((res) => !cancelled && setStaff(res.items))
      .catch((err: unknown) => !cancelled && setListError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Staff & roles</h1>
        <p className={styles.subtitle}>
          Create admin, editor and support accounts. To change someone’s role,
          open their user page.
        </p>
      </header>

      <CreateStaffForm onCreated={() => setReloadKey((k) => k + 1)} />

      <section aria-labelledby="team-heading">
        <h2 id="team-heading" className={styles.sectionTitle}>
          Team
        </h2>
        {listError && <p role="alert">{listError}</p>}
        {!staff && !listError && <p aria-busy="true">Loading staff…</p>}
        {staff && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last login</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userCell}>
                      <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
                      <span>{u.email}</span>
                    </div>
                  </td>
                  <td data-label="Role">
                    <RoleBadge role={u.role} />
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={u.status} />
                  </td>
                  <td data-label="Last login">{formatDate(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function CreateStaffForm({ onCreated }: { onCreated: () => void }) {
  const [role, setRole] = useState<StaffRole>('editor');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const phone = String(form.get('phone')).trim();
      const { message } = await adminApi.createStaff({
        name: String(form.get('name')),
        email: String(form.get('email')),
        role,
        ...(phone && { phone }),
      });
      setSuccess(message);
      formEl.reset();
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="create-heading">
      <h2 id="create-heading">Add a staff member</h2>
      <form onSubmit={handleSubmit} className={styles.stack}>
        <div className={styles.formGrid}>
          <FormField
            label="Full name"
            name="name"
            required
            minLength={2}
            maxLength={100}
          />
          <FormField label="Work email" name="email" type="email" required />
          <FormField
            label="Phone (optional)"
            name="phone"
            type="tel"
            placeholder="+919876543210"
          />
          <div className={styles.field}>
            <label htmlFor="staff-role">Role</label>
            <select
              id="staff-role"
              className={styles.select}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {STAFF_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {ROLE_LABELS[o.value]}
                </option>
              ))}
            </select>
            <small className={styles.muted}>
              {STAFF_ROLE_OPTIONS.find((o) => o.value === role)?.hint}
            </small>
          </div>
        </div>
        <p className={styles.muted} style={{ margin: 0 }}>
          They’ll receive an account-setup code by email and choose their own
          password.
        </p>
        <FormAlert>{error}</FormAlert>
        <FormAlert kind="success">{success}</FormAlert>
        <div>
          <button className={btn.primary} disabled={saving}>
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </section>
  );
}
