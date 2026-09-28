import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import btn from '../../../components/ui/Button.module.css';
import { formatDate } from '../../../features/admin/api';
import {
  examsApi,
  formatMinutes,
  KIND_LABELS,
  type CatalogExam,
  type ExamKind,
  type MySession,
} from '../../../features/exams/api';
import { errorMessage } from '../../../lib/api';
import styles from './Tests.module.css';

const TABS: { kind: ExamKind | ''; label: string }[] = [
  { kind: '', label: 'All' },
  { kind: 'mock_exam', label: 'Mock tests' },
  { kind: 'virtual_interview', label: 'Virtual interviews' },
];

/** Candidate catalog of published exams and interviews (FRD §4.6). */
export function TestsPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') ?? '') as ExamKind | '';
  const [exams, setExams] = useState<CatalogExam[] | null>(null);
  const [mine, setMine] = useState<MySession[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([examsApi.catalog(kind || undefined), examsApi.mine()])
      .then(([e, m]) => {
        if (cancelled) return;
        setExams(e);
        setMine(m);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Mock tests & interviews</h1>
        <p className={styles.subtitle}>
          Timed practice under exam conditions. Your answers save as you go, so
          you can pick up where you left off if your connection drops.
        </p>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Type">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={kind === t.kind}
            className={styles.tab}
            onClick={() => setParams(t.kind ? { kind: t.kind } : {})}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p role="alert">{error}</p>}
      {!exams && !error && <p aria-busy="true">Loading tests…</p>}
      {exams?.length === 0 && (
        <div className={styles.empty}>
          <p>No tests are available yet. Check back soon.</p>
        </div>
      )}
      {exams && exams.length > 0 && (
        <ul className={styles.cards}>
          {exams.map((e) => (
            <li key={e.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.kind} data-kind={e.kind}>
                  {KIND_LABELS[e.kind]}
                </span>
                {e.inProgressSessionId && (
                  <span className={styles.inProgress}>In progress</span>
                )}
              </div>
              <h2>{e.title}</h2>
              {e.description && <p className={styles.muted}>{e.description}</p>}
              <p className={styles.meta}>
                {[
                  formatMinutes(e.durationMinutes),
                  `${e.questionCount} question${e.questionCount === 1 ? '' : 's'}`,
                  `${e.totalMarks} marks`,
                  e.hasCoding && 'Includes coding',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className={styles.cardFoot}>
                <small className={styles.muted}>
                  {e.maxAttempts
                    ? `${e.attemptsUsed} of ${e.maxAttempts} attempts used`
                    : e.attemptsUsed
                      ? `${e.attemptsUsed} attempt${e.attemptsUsed === 1 ? '' : 's'}`
                      : 'Not attempted yet'}
                </small>
                {e.inProgressSessionId ? (
                  <Link
                    to={`/exam/${e.inProgressSessionId}`}
                    className={btn.primary}
                  >
                    Resume
                  </Link>
                ) : e.canStart ? (
                  <Link to={`/tests/${e.id}`} className={btn.primary}>
                    {e.attemptsUsed ? 'Try again' : 'Start'}
                  </Link>
                ) : (
                  <span className={styles.muted}>No attempts left</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {mine.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Your recent attempts</h2>
          <ul className={styles.attempts}>
            {mine.slice(0, 8).map((m) => (
              <li key={m.id}>
                <div>
                  <strong>{m.title}</strong>
                  <span className={styles.muted}>
                    Attempt #{m.attemptNumber} · started{' '}
                    {formatDate(m.startedAt)}
                  </span>
                </div>
                {m.status === 'in_progress' ? (
                  <Link to={`/exam/${m.id}`} className={btn.secondary}>
                    Resume
                  </Link>
                ) : (
                  <span className={styles.muted}>
                    {m.submitReason === 'time_expired'
                      ? 'Auto-submitted (time up)'
                      : m.submitReason === 'abandoned'
                        ? 'Auto-submitted (left unfinished)'
                        : 'Submitted'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
