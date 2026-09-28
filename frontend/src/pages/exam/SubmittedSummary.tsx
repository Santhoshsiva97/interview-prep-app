import { Link } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import type { SessionItem, SessionView } from '../../features/exams/api';
import styles from './ExamRuntime.module.css';

const REASON: Record<string, string> = {
  manual: 'You submitted this test.',
  time_expired: 'Time ran out, so your test was submitted automatically.',
  abandoned:
    'This attempt was left unfinished for too long, so it was submitted automatically.',
};

/** Shown once an attempt is closed. Scores arrive with grading (Step 8/9). */
export function SubmittedSummary({
  session,
  items,
}: {
  session: SessionView;
  items: SessionItem[];
}) {
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
        <p className={styles.muted}>
          Your answers have been recorded. Your score will appear in History &
          Scorecards once it has been graded.
        </p>
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
