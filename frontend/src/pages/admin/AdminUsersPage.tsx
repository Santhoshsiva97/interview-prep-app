import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import {
  adminApi,
  formatDate,
  ROLE_LABELS,
  STATUS_LABELS,
  type AdminUserSummary,
  type Paginated,
  type UserListQuery,
  type UserSort,
  type UserStatus,
} from '../../features/admin/api';
import {
  RoleBadge,
  StatusBadge,
} from '../../features/admin/components/UserBadges';
import type { UserRole } from '../../features/auth/api';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

const PAGE_SIZE = 20;
const SORT_LABELS: Record<UserSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  last_login: 'Recently active',
};

/** User search & list (FRD §4.3). Filters live in the URL so back/forward and links work. */
export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const query: UserListQuery = {
    search: params.get('search') ?? '',
    role: (params.get('role') as UserRole) || undefined,
    status: (params.get('status') as UserStatus) || undefined,
    sort: (params.get('sort') as UserSort) || 'newest',
    page: Number(params.get('page')) || 1,
    pageSize: PAGE_SIZE,
  };
  const queryKey = params.toString();

  const [result, setResult] = useState<Paginated<AdminUserSummary> | null>(
    null,
  );
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState(query.search ?? '');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listUsers(query)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
    // queryKey captures every input of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  /** Updates one filter and resets to page 1. */
  const setFilter = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: key === 'search' },
    );
  };

  // Debounce typing into the URL.
  useEffect(() => {
    if (searchText === (params.get('search') ?? '')) return;
    const t = setTimeout(() => setFilter('search', searchText.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const first = result ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = result ? first + result.items.length - 1 : 0;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Users</h1>
        <p className={styles.subtitle}>
          Search candidates and staff, review accounts and take action.
        </p>
      </header>

      <div className={styles.filters} role="search">
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            type="search"
            placeholder="Search name, email or phone"
            aria-label="Search users"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <select
          className={styles.select}
          aria-label="Filter by role"
          value={query.role ?? ''}
          onChange={(e) => setFilter('role', e.target.value)}
        >
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Filter by status"
          value={query.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Sort"
          value={query.sort}
          onChange={(e) =>
            setFilter('sort', e.target.value === 'newest' ? '' : e.target.value)
          }
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}
      {!result && !error && <p aria-busy="true">Loading users…</p>}

      {result && (
        <>
          {result.items.length === 0 ? (
            <div className={`${styles.card} ${styles.empty}`}>
              <p className={styles.muted}>No users match these filters.</p>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last login</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((u) => (
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
                      {u.lockedUntil && (
                        <span
                          className={styles.badge}
                          data-tone="danger"
                          style={{ marginLeft: 6 }}
                          title={`Locked until ${formatDate(u.lockedUntil, true)}`}
                        >
                          Locked
                        </span>
                      )}
                    </td>
                    <td data-label="Last login">{formatDate(u.lastLoginAt)}</td>
                    <td data-label="Joined">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <nav className={styles.pager} aria-label="Pagination">
            <span aria-live="polite">
              {result.total === 0
                ? '0 users'
                : `Showing ${first}–${last} of ${result.total.toLocaleString()}`}
            </span>
            <div className={styles.pagerButtons}>
              <button
                type="button"
                className={btn.secondary}
                disabled={result.page <= 1}
                onClick={() => setFilter('page', String(result.page - 1))}
              >
                <Icon name="chevronLeft" size={16} /> Previous
              </button>
              <button
                type="button"
                className={btn.secondary}
                disabled={result.page >= result.totalPages}
                onClick={() => setFilter('page', String(result.page + 1))}
              >
                Next <Icon name="chevronRight" size={16} />
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
