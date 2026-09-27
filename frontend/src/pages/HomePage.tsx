import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiFetch } from '../lib/api';
import styles from './HomePage.module.css';

type ApiStatus = 'checking' | 'ok' | 'degraded' | 'unreachable';

const statusLabel: Record<ApiStatus, string> = {
  checking: 'Checking API…',
  ok: 'API online',
  degraded: 'API up, a dependency is down',
  unreachable: 'API unreachable',
};

export function HomePage() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    apiFetch('/health')
      .then(() => setApiStatus('ok'))
      .catch((err: unknown) =>
        setApiStatus(
          err instanceof ApiError && err.status === 503
            ? 'degraded'
            : 'unreachable',
        ),
      );
  }, []);

  return (
    <>
      <section className={styles.hero}>
        <h1>Prepare for your next technical interview</h1>
        <p className={styles.lead}>
          Practice MCQ and coding questions, take timed mock exams and virtual
          interviews, and track your progress with detailed analytics.
        </p>
        <div className={styles.ctas}>
          <Link to="/practice" className="button">
            Start practicing
          </Link>
          <Link to="/exams">Browse mock exams</Link>
        </div>
      </section>

      <p className={styles.status} data-status={apiStatus}>
        <span className={styles.dot} aria-hidden="true" />
        {statusLabel[apiStatus]}
      </p>
    </>
  );
}
