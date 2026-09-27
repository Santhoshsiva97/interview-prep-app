import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { FormAlert } from '../../components/form/FormField';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import { Dialog } from '../../components/ui/Dialog';
import {
  adminApi,
  canManage,
  formatDate,
  ROLE_LABELS,
  type AdminUserDetail,
  type AssignableRole,
} from '../../features/admin/api';
import {
  RoleBadge,
  StatusBadge,
} from '../../features/admin/components/UserBadges';
import { useAuth } from '../../features/auth/useAuth';
import { formatBytes } from '../../features/profile/api';
import { Avatar } from '../../features/profile/components/Avatar';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

type PendingAction = 'suspend' | 'reactivate' | 'force-logout' | 'role' | null;

export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const { user: actor } = useAuth();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getUser(id)
      .then((u) => !cancelled && setUser(u))
      .catch((err: unknown) => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Link to="/admin/users" className={styles.backLink}>
      <Icon name="arrowLeft" size={16} /> All users
    </Link>
  );

  if (loadError) {
    return (
      <div className={styles.page}>
        {back}
        <p role="alert">{loadError}</p>
      </div>
    );
  }
  if (!user || !actor) return <p aria-busy="true">Loading user…</p>;

  const p = user.profile;
  return (
    <div className={styles.page}>
      {back}
      <header className={styles.identity}>
        <Avatar name={user.name} url={user.avatarUrl} size={64} />
        <div>
          <h1>{user.name}</h1>
          <span className={styles.muted}>{user.email}</span>
          <div className={styles.badges}>
            <RoleBadge role={user.role} />
            <StatusBadge status={user.status} />
            {user.lockedUntil && (
              <span className={styles.badge} data-tone="danger">
                Locked until {formatDate(user.lockedUntil, true)}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.stack}>
          {user.suspension && (
            <div className={styles.alertBox} role="status">
              <strong>
                Suspended {formatDate(user.suspension.at, true)}
                {user.suspension.by && ` by ${user.suspension.by.name}`}
              </strong>
              {user.suspension.reason && (
                <p>Reason: {user.suspension.reason}</p>
              )}
            </div>
          )}

          <section className={styles.card} aria-labelledby="account-heading">
            <h2 id="account-heading">Account</h2>
            <dl className={styles.facts}>
              <Fact label="Phone" value={user.phone ?? '—'} />
              <Fact label="Joined" value={formatDate(user.createdAt)} />
              <Fact
                label="Email verified"
                value={
                  user.emailVerifiedAt
                    ? formatDate(user.emailVerifiedAt)
                    : 'Not yet'
                }
              />
              <Fact
                label="Last login"
                value={formatDate(user.lastLoginAt, true)}
              />
              <Fact
                label="Active sessions"
                value={String(user.activeSessions)}
              />
              <Fact
                label="Failed login attempts"
                value={String(user.failedLoginAttempts)}
              />
              <Fact
                label="Password set"
                value={user.hasPassword ? 'Yes' : 'No'}
              />
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profile</h2>
            <dl className={styles.facts}>
              <Fact label="Headline" value={p.headline ?? '—'} />
              <Fact label="Target role" value={p.targetRole ?? '—'} />
              <Fact
                label="Experience"
                value={
                  p.experienceYears != null ? `${p.experienceYears} yrs` : '—'
                }
              />
              <Fact label="Location" value={p.location ?? '—'} />
              <Fact
                label="LinkedIn"
                value={
                  p.linkedinUrl ? <ExternalLink href={p.linkedinUrl} /> : '—'
                }
              />
              <Fact
                label="GitHub"
                value={p.githubUrl ? <ExternalLink href={p.githubUrl} /> : '—'}
              />
              <Fact
                label="Resume"
                value={
                  user.resume ? (
                    <a
                      href={user.resume.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {user.resume.fileName} (
                      {formatBytes(user.resume.sizeBytes)})
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
            </dl>
            {p.bio && <p className={styles.muted}>{p.bio}</p>}
          </section>
        </div>

        <UserActions user={user} actor={actor} onChange={setUser} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {href.replace(/^https:\/\/(www\.)?/, '')}
    </a>
  );
}

interface UserActionsProps {
  user: AdminUserDetail;
  actor: { id: string; role: AdminUserDetail['role'] };
  onChange: (user: AdminUserDetail) => void;
}

/** Suspend / reactivate / force-logout (admins) and role changes (super admins). */
function UserActions({ user, actor, onChange }: UserActionsProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [role, setRole] = useState<AssignableRole>(
    user.role === 'super_admin' ? 'admin' : user.role,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const manageable = canManage(actor, user);
  const isSuperAdmin = actor.role === 'super_admin';

  if (!manageable) {
    const why =
      actor.id === user.id
        ? 'You can’t manage your own account here.'
        : user.role === 'super_admin'
          ? 'Super admin accounts can’t be managed here.'
          : user.role !== 'candidate'
            ? 'Only a super admin can manage staff accounts.'
            : 'Your role can view but not change accounts.';
    return (
      <aside className={styles.card} aria-labelledby="actions-heading">
        <h2 id="actions-heading">Actions</h2>
        <p className={styles.muted}>{why}</p>
      </aside>
    );
  }

  const close = () => {
    if (busy) return;
    setPending(null);
    setError('');
  };

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      if (pending === 'suspend') {
        onChange(await adminApi.suspend(user.id, reason.trim()));
        setNotice('Account suspended and signed out everywhere.');
        setReason('');
      } else if (pending === 'reactivate') {
        onChange(await adminApi.reactivate(user.id));
        setNotice('Account reactivated. They can log in again.');
      } else if (pending === 'force-logout') {
        const { revokedSessions } = await adminApi.forceLogout(user.id);
        onChange({ ...user, activeSessions: 0 });
        setNotice(
          `Signed out of ${revokedSessions} session${revokedSessions === 1 ? '' : 's'}.`,
        );
      } else if (pending === 'role') {
        onChange(await adminApi.changeRole(user.id, role));
        setNotice(
          `Role changed to ${ROLE_LABELS[role]}. Their sessions were ended so it applies right away.`,
        );
      }
      setPending(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const dialogs: Record<
    Exclude<PendingAction, null>,
    {
      title: string;
      body: ReactNode;
      confirm: string;
      danger?: boolean;
      disabled?: boolean;
    }
  > = {
    suspend: {
      title: `Suspend ${user.name}?`,
      body: (
        <>
          <p>
            They’ll be signed out immediately and won’t be able to log in until
            reactivated.
          </p>
          <div className={styles.field}>
            <label htmlFor="suspend-reason">Reason (visible to admins)</label>
            <textarea
              id="suspend-reason"
              className={styles.input}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Sharing exam questions publicly"
            />
          </div>
        </>
      ),
      confirm: 'Suspend account',
      danger: true,
      disabled: reason.trim().length < 3,
    },
    reactivate: {
      title: `Reactivate ${user.name}?`,
      body: <p>They’ll be able to log in again.</p>,
      confirm: 'Reactivate',
    },
    'force-logout': {
      title: `Sign ${user.name} out everywhere?`,
      body: (
        <p>
          All {user.activeSessions} active session(s) end immediately. They can
          log back in.
        </p>
      ),
      confirm: 'Sign out everywhere',
      danger: true,
    },
    role: {
      title: `Change role to ${ROLE_LABELS[role]}?`,
      body: (
        <p>
          {user.name} goes from {ROLE_LABELS[user.role]} to {ROLE_LABELS[role]}.
          Their current sessions end so the new permissions apply right away.
        </p>
      ),
      confirm: 'Change role',
    },
  };
  const d = pending ? dialogs[pending] : null;

  return (
    <aside className={styles.card} aria-labelledby="actions-heading">
      <h2 id="actions-heading">Actions</h2>
      <FormAlert kind="success">{notice}</FormAlert>
      <div className={styles.actions}>
        {user.status === 'suspended' ? (
          <button
            type="button"
            className={btn.primary}
            onClick={() => setPending('reactivate')}
          >
            Reactivate account
          </button>
        ) : (
          <button
            type="button"
            className={btn.danger}
            onClick={() => setPending('suspend')}
          >
            Suspend account
          </button>
        )}
        <button
          type="button"
          className={btn.secondary}
          onClick={() => setPending('force-logout')}
          disabled={user.activeSessions === 0}
          title={user.activeSessions === 0 ? 'No active sessions' : undefined}
        >
          Force logout
        </button>
      </div>

      {isSuperAdmin && (
        <div className={styles.field}>
          <label htmlFor="role-select">Role</label>
          <select
            id="role-select"
            className={styles.select}
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
          >
            {(['candidate', 'editor', 'support', 'admin'] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn.secondary}
            disabled={role === user.role}
            onClick={() => setPending('role')}
          >
            Update role
          </button>
        </div>
      )}

      <Dialog
        open={d !== null}
        title={d?.title ?? ''}
        onClose={close}
        actions={
          <>
            <button
              type="button"
              className={btn.secondary}
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={d?.danger ? btn.danger : btn.primary}
              onClick={() => void confirm()}
              disabled={busy || d?.disabled}
            >
              {busy ? 'Working…' : d?.confirm}
            </button>
          </>
        }
      >
        {d?.body}
        <FormAlert>{error}</FormAlert>
      </Dialog>
    </aside>
  );
}
