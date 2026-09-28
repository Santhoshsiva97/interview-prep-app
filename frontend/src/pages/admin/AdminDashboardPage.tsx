import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import { adminApi, type AdminDashboard } from '../../features/admin/api';
import { analyticsApi, type Overview } from '../../features/analytics/api';
import { DailyColumns } from '../../features/analytics/components/Charts';
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

const DAYS = 30;

/** Admin dashboard (FRD §4.3 / §4.9): KPIs, plus 30-day trends for admin & support. */
export function AdminDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trendsError, setTrendsError] = useState('');
  const [trendsAttempt, setTrendsAttempt] = useState(0);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const canSeeUsers =
    user?.role === 'admin' ||
    user?.role === 'support' ||
    user?.role === 'super_admin';

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

  // Trends load after the KPIs (the heavier query shouldn't hold up the page).
  const loaded = data !== null;
  useEffect(() => {
    if (!canSeeUsers || !loaded) return;
    let cancelled = false;
    analyticsApi
      .overview(DAYS)
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        setTrendsError('');
      })
      .catch((err: unknown) => !cancelled && setTrendsError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [canSeeUsers, loaded, trendsAttempt]);

  async function exportCsv() {
    setExporting(true);
    try {
      await analyticsApi.overviewCsv(DAYS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p aria-busy="true">Loading dashboard…</p>;

  const u = data.users.data;
  const live = data.users.status === 'live';
  const e = data.engagement;
  const tv = data.testVolume;
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
  const engagementKpis: Kpi[] = [
    {
      label: 'Daily active users',
      value: e.data.dau,
      hint:
        e.data.stickiness !== null
          ? `${e.data.stickiness}% of monthly users`
          : undefined,
      live: e.status === 'live',
    },
    {
      label: 'Monthly active users',
      value: e.data.mau,
      hint: e.data.wau !== null ? `${e.data.wau} this week` : undefined,
      live: e.status === 'live',
    },
    {
      label: 'Tests taken (7 days)',
      value: tv.data.attempts7d,
      hint:
        tv.data.attempts30d !== null
          ? `${tv.data.attempts30d} in the last 30 days`
          : undefined,
      live: tv.status === 'live',
    },
    {
      label: 'Average score (30 days)',
      value: tv.data.avgPercent30d === null ? '—' : `${tv.data.avgPercent30d}%`,
      hint:
        tv.data.graded30d !== null
          ? `${tv.data.graded30d} graded attempts`
          : undefined,
      live: tv.status === 'live',
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
  ];

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
          Engagement & tests
        </h2>
        <KpiGrid kpis={engagementKpis} />
        <p
          className={styles.muted}
          style={{ margin: '8px 0 0', fontSize: '0.8125rem' }}
        >
          Active = a candidate who used the app (signed in or kept a session
          open) in the period.
        </p>
      </section>

      {canSeeUsers && !overview && trendsError && (
        <div className={styles.alertBox} role="alert">
          Couldn’t load the 30-day trends: {trendsError}{' '}
          <button
            type="button"
            className={styles.linkish}
            onClick={() => {
              setTrendsError('');
              setTrendsAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {overview && (
        <section aria-labelledby="kpi-trends">
          <div className={styles.sectionHead}>
            <h2 id="kpi-trends" className={styles.sectionTitle}>
              Last {DAYS} days (UTC)
            </h2>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              <Icon name="file" size={16} />{' '}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
          <div className={styles.multiples}>
            <DailyColumns
              title="Sign-ups"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.signups,
              }))}
            />
            <DailyColumns
              title="Active users"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.activeUsers,
              }))}
              headline={String(overview.kpis.mau)}
            />
            <DailyColumns
              title="Tests submitted"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.attemptsSubmitted,
              }))}
            />
            <DailyColumns
              title="Average score"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.avgPercent,
              }))}
              format={(v) => `${Math.round(v)}%`}
              headline={
                overview.kpis.avgPercent30d === null
                  ? '—'
                  : `${Math.round(overview.kpis.avgPercent30d)}%`
              }
            />
          </div>
          <p
            className={styles.muted}
            style={{ margin: '8px 0 0', fontSize: '0.8125rem' }}
          >
            Headlines are for the whole period (active users: distinct people;
            average score: across all graded attempts). Hover a day for its
            value; the CSV has every day.
          </p>
        </section>
      )}
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
