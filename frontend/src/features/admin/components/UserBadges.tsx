import styles from '../../../pages/admin/Admin.module.css';
import type { UserRole } from '../../auth/api';
import { ROLE_LABELS, STATUS_LABELS, type UserStatus } from '../api';

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={styles.badge}
      data-tone={role === 'candidate' ? undefined : 'primary'}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

const STATUS_TONE: Record<UserStatus, string | undefined> = {
  active: 'success',
  pending_verification: undefined,
  suspended: 'danger',
};

export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span className={styles.badge} data-tone={STATUS_TONE[status]}>
      {STATUS_LABELS[status]}
    </span>
  );
}
