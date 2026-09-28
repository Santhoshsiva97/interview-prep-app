import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import btn from '../../../components/ui/Button.module.css';
import { formatDate } from '../../../features/admin/api';
import { KIND_LABELS } from '../../../features/exams/api';
import {
  fmtMarks,
  fmtPercent,
  ordinal,
  scorecardsApi,
  type AttemptListItem,
} from '../../../features/scorecards/api';
import { errorMessage } from '../../../lib/api';
import styles from './History.module.css';

/** History & Scorecards (FRD §4.8): every submitted attempt, newest first. */
export function HistoryPage() {
  const [attempts, setAttempts] = useState<AttemptListItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    scorecardsApi
      .list()
      .then((a) => !cancelled && setAttempts(a))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>History & Scorecards</h1>
        <p className={styles.subtitle}>
          Your mock tests and interviews, with scores, section breakdowns and
          answer review.
        </p>
      </header>

      {error && <p role="alert">{error}</p>}
      {!attempts && !error && <p aria-busy="true">Loading your attempts…</p>}
      {attempts?.length === 0 && (
        <div className={styles.empty}>
          <p>You haven’t finished a test yet.</p>
          <Link to="/tests" className={btn.primary}>
            Browse mock tests
          </Link>
        </div>
      )}
      {attempts && attempts.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Test</th>
              <th scope="col">Score</th>
              <th scope="col">Percentile</th>
              <th scope="col">Result</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.sessionId}>
                <td>
                  <div className={styles.testCell}>
                    <Link to={`/history/${a.sessionId}`}>{a.title}</Link>
                    <span>
                      {KIND_LABELS[a.kind]} · attempt #{a.attemptNumber} ·{' '}
                      {formatDate(a.submittedAt)}
                    </span>
                  </div>
                </td>
                <td data-label="Score">
                  {a.result ? (
                    <>
                      <strong>
                        {fmtMarks(a.result.score)} /{' '}
                        {fmtMarks(a.result.maxScore)}
                      </strong>{' '}
                      <span className={styles.muted}>
                        ({fmtPercent(a.result.percent)})
                      </span>
                    </>
                  ) : (
                    <GradingNote status={a.gradingStatus} />
                  )}
                </td>
                <td data-label="Percentile">
                  {a.result ? ordinal(a.result.percentile) : '—'}
                </td>
                <td data-label="Result">
                  {a.result?.passed === true && (
                    <span className={styles.badge} data-tone="success">
                      Passed
                    </span>
                  )}
                  {a.result?.passed === false && (
                    <span className={styles.badge} data-tone="danger">
                      Not passed
                    </span>
                  )}
                  {a.result && a.result.passed === null && (
                    <span className={styles.muted}>No pass mark</span>
                  )}
                  {!a.result && '—'}
                </td>
                <td className={styles.actionCell}>
                  <Link
                    to={`/history/${a.sessionId}`}
                    className={btn.secondary}
                  >
                    {a.result ? 'View scorecard' : 'View'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GradingNote({ status }: { status: AttemptListItem['gradingStatus'] }) {
  return (
    <span className={styles.muted}>
      {status === 'failed' ? 'Grading delayed' : 'Grading…'}
    </span>
  );
}
