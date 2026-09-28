import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import {
  examsApi,
  type SessionItem,
  type SessionView,
} from '../../features/exams/api';
import styles from './ExamRuntime.module.css';

const REASON: Record<string, string> = {
  manual: 'You submitted this test.',
  time_expired: 'Time ran out, so your test was submitted automatically.',
  abandoned:
    'This attempt was left unfinished for too long, so it was submitted automatically.',
};

const POLL_MS = 3000;

const marks = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Shown once an attempt is closed. Grading runs in the background (FRD §4.7),
 * so this polls until the score is ready. The full scorecard is Step 9.
 */
export function SubmittedSummary({
  session: initial,
  items: initialItems,
}: {
  session: SessionView;
  items: SessionItem[];
}) {
  const [session, setSession] = useState(initial);
  const status = session.grading?.status;
  const waiting = status === 'pending' || status === 'grading';

  useEffect(() => {
    if (!waiting) return;
    const id = window.setTimeout(() => {
      examsApi.view(session.id).then(setSession, () => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(id);
  }, [waiting, session]);

  const items = session === initial ? initialItems : session.items;
  const answered = items.filter((i) => i.answered).length;
  const minutes =
    session.submittedAt &&
    Math.max(
      1,
      Math.round(
        (new Date(session.submittedAt).getTime() -
          new Date(session.startedAt).getTime()) /
          60_000,
      ),
    );
  const grading = session.grading;
  const correct = items.filter((i) => i.result?.outcome === 'correct').length;

  return (
    <div className={styles.centered}>
      <div className={styles.doneCard}>
        <span className={styles.doneIcon} aria-hidden="true">
          <Icon name="check" size={28} />
        </span>
        <h1>Answers submitted</h1>
        <p className={styles.muted}>
          {REASON[session.submitReason ?? 'manual']}
        </p>

        <div className={styles.scoreBox} aria-live="polite">
          {grading?.status === 'graded' && grading.score !== null ? (
            <>
              <span>Your score</span>
              <strong>
                {marks(grading.score)} <small>/ {grading.maxScore}</small>
              </strong>
              <span>
                {correct} of {items.length} questions fully correct
              </span>
            </>
          ) : grading?.status === 'failed' ? (
            <span>
              We couldn’t finish grading your answers yet. We’ll try again, and
              your score will appear in History & Scorecards.
            </span>
          ) : (
            <span aria-busy="true">Grading your answers…</span>
          )}
        </div>

        <dl className={styles.doneStats}>
          <div>
            <dt>Test</dt>
            <dd>{session.exam.title}</dd>
          </div>
          <div>
            <dt>Answered</dt>
            <dd>
              {answered} of {items.length}
            </dd>
          </div>
          {minutes && (
            <div>
              <dt>Time taken</dt>
              <dd>{minutes} min</dd>
            </div>
          )}
          <div>
            <dt>Attempt</dt>
            <dd>#{session.attemptNumber}</dd>
          </div>
        </dl>
        <div className={styles.doneActions}>
          <Link to="/tests" className={btn.primary}>
            Back to tests
          </Link>
          <Link to="/dashboard" className={btn.secondary}>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
