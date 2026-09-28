import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from '../../components/icons/Icon';
import { PORTAL_NAV } from '../../components/layout/portalNav';
import { dashboardApi, type Dashboard } from '../../features/dashboard/api';
import { useProfile } from '../../features/profile/useProfile';
import { errorMessage } from '../../lib/api';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  // Refetch when the profile changes so completeness stays in sync.
  const { profile } = useProfile();
  const profileVersion = profile?.completeness.percent;

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .get()
      .then((d) => !cancelled && setDashboard(d))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [profileVersion]);

  if (error) return <p role="alert">{error}</p>;
  if (!dashboard) return <p aria-busy="true">Loading your dashboard…</p>;

  const firstName = dashboard.user.name.split(' ')[0];
  const { profileCompleteness, streak, recentActivity, recommendedTests } =
    dashboard;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Welcome back, {firstName}</h1>
        <p className={styles.subtitle}>
          Here’s where your interview prep stands today.
        </p>
      </header>

      <div className={styles.grid}>
        <Widget
          icon="flame"
          title="Daily streak"
          comingSoon={streak.status !== 'live'}
        >
          {streak.status === 'live' && streak.data ? (
            <p className={styles.bigStat}>
              {streak.data.currentDays}
              <span> day{streak.data.currentDays === 1 ? '' : 's'}</span>
              <small>Longest: {streak.data.longestDays} days</small>
            </p>
          ) : (
            <Empty>
              Your streak starts counting once practice tracking is live.
            </Empty>
          )}
        </Widget>

        <Widget icon="profile" title="Profile strength">
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuenow={profileCompleteness.data.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Profile completeness"
          >
            <span style={{ width: `${profileCompleteness.data.percent}%` }} />
          </div>
          <p className={styles.progressLabel}>
            <strong>{profileCompleteness.data.percent}%</strong> complete
          </p>
          {profileCompleteness.data.missing.length > 0 ? (
            <>
              <ul className={styles.todo}>
                {profileCompleteness.data.missing.slice(0, 3).map((item) => (
                  <li key={item}>Add {item.toLowerCase()}</li>
                ))}
              </ul>
              <Link to="/profile">Complete your profile →</Link>
            </>
          ) : (
            <p className={styles.done}>
              <Icon name="check" size={18} /> Your profile is complete.
            </p>
          )}
        </Widget>

        <Widget
          icon="activity"
          title="Recent activity"
          comingSoon={recentActivity.status !== 'live'}
        >
          {recentActivity.status === 'live' && recentActivity.data.length ? (
            <ul className={styles.list}>
              {recentActivity.data.map((a) => (
                <li key={a.id}>
                  {a.type === 'practice' ? (
                    <span>{a.title}</span>
                  ) : (
                    <Link to={`/history/${a.id}`}>{a.title}</Link>
                  )}
                  <span className={styles.meta}>
                    {a.result && `${a.result} · `}
                    {new Date(a.occurredAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              No activity yet. Your practice sessions, mock exams and interviews
              will show up here.
            </Empty>
          )}
        </Widget>

        <Widget
          icon="target"
          title="Recommended tests"
          comingSoon={recommendedTests.status !== 'live'}
        >
          {recommendedTests.status === 'live' &&
          recommendedTests.data.length ? (
            <ul className={styles.list}>
              {recommendedTests.data.map((t) => (
                <li key={t.id}>
                  <span>{t.title}</span>
                  <span className={styles.meta}>
                    {t.topic} · {t.difficulty} · {t.durationMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              Personalised test recommendations will appear here based on your
              strengths and weak spots.
            </Empty>
          )}
        </Widget>
      </div>

      <section aria-labelledby="quick-links">
        <h2 id="quick-links" className={styles.sectionTitle}>
          Quick links
        </h2>
        <div className={styles.quickLinks}>
          {PORTAL_NAV.filter((n) => n.to !== '/dashboard').map((n) => (
            <Link key={n.to} to={n.to} className={styles.quickLink}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

interface WidgetProps {
  icon: IconName;
  title: string;
  comingSoon?: boolean;
  children: ReactNode;
}

function Widget({ icon, title, comingSoon, children }: WidgetProps) {
  return (
    <section className={styles.widget}>
      <header className={styles.widgetHeader}>
        <span className={styles.widgetIcon}>
          <Icon name={icon} size={18} />
        </span>
        <h2>{title}</h2>
        {comingSoon && <span className={styles.badge}>Coming soon</span>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
