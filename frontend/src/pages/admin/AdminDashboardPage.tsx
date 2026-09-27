import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { adminApi, type AdminDashboard } from '../../features/admin/api';
import { useAuth } from '../../features/auth/useAuth';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

interface Kpi {
  label: string;
  value: number | string | null;
  hint?: string;
  live: boolean;
}

const money = (cents: number | null) =>
  cents === null
    ? null
    : (cents / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: 'INR',
      });

export function AdminDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .dashboard()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p aria-busy="true">Loading dashboard…</p>;

  const u = data.users.data;
  const live = data.users.status === 'live';
  const userKpis: Kpi[] = [
    {
      label: 'Candidates',
      value: u.totalCandidates,
      hint: `${u.activeCandidates} active · ${u.pendingVerification} unverified`,
      live,
    },
    {
      label: 'New sign-ups (7 days)',
      value: u.newSignups7d,
      hint: `${u.newSignups30d} in the last 30 days`,
      live,
    },
    { label: 'Suspended accounts', value: u.suspended, live },
    {
      label: 'Staff accounts',
      value: u.staff,
      hint: 'Editors, support, admins',
      live,
    },
  ];
  const upcoming: Kpi[] = [
    {
      label: 'Daily active users',
      value: data.engagement.data.dau,
      live: data.engagement.status === 'live',
    },
    {
      label: 'Monthly active users',
      value: data.engagement.data.mau,
      live: data.engagement.status === 'live',
    },
    {
      label: 'Active subscriptions',
      value: data.subscriptions.data.active,
      live: data.subscriptions.status === 'live',
    },
    {
      label: 'Revenue this month',
      value: money(data.subscriptions.data.revenueThisMonthCents),
      live: data.subscriptions.status === 'live',
    },
    {
      label: 'Tests taken (7 days)',
      value: data.testVolume.data.attempts7d,
      live: data.testVolume.status === 'live',
    },
  ];
  const canSeeUsers =
    user?.role === 'admin' ||
    user?.role === 'support' ||
    user?.role === 'super_admin';

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Admin dashboard</h1>
        <p className={styles.subtitle}>Platform health at a glance.</p>
      </header>

      <section aria-labelledby="kpi-users">
        <h2 id="kpi-users" className={styles.sectionTitle}>
          Users
        </h2>
        <KpiGrid kpis={userKpis} />
        {canSeeUsers && (
          <p>
            <Link to="/admin/users">Manage users →</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="kpi-platform">
        <h2 id="kpi-platform" className={styles.sectionTitle}>
          Engagement & revenue
        </h2>
        <KpiGrid kpis={upcoming} />
      </section>
    </div>
  );
}

function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className={styles.kpis}>
      {kpis.map((k) => (
        <div key={k.label} className={styles.kpi}>
          <span className={styles.kpiLabel}>
            {k.label}
            {!k.live && <span className={styles.badge}>Coming soon</span>}
          </span>
          <span
            className={`${styles.kpiValue} ${k.live ? '' : styles.placeholder}`}
          >
            {k.live && k.value !== null ? k.value.toLocaleString() : '—'}
          </span>
          {k.live && k.hint && <span className={styles.kpiHint}>{k.hint}</span>}
        </div>
      ))}
    </div>
  );
}
