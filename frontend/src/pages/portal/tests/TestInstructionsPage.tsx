import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormField';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { Markdown } from '../../../components/ui/Markdown';
import {
  examsApi,
  formatMinutes,
  KIND_LABELS,
  type CatalogExamDetail,
} from '../../../features/exams/api';
import { errorMessage } from '../../../lib/api';
import styles from './Tests.module.css';

/** Pre-test instructions and consent (FRD §4.6). Starting requires ticking the box. */
export function TestInstructionsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<CatalogExamDetail | null>(null);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  useEffect(() => {
    let cancelled = false;
    examsApi
      .get(id)
      .then((e) => !cancelled && setExam(e))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Link to="/tests" className={styles.backLink}>
      <Icon name="arrowLeft" size={16} /> All tests
    </Link>
  );
  if (error)
    return (
      <div className={styles.page}>
        {back}
        <p role="alert">{error}</p>
      </div>
    );
  if (!exam) return <p aria-busy="true">Loading…</p>;

  async function start() {
    setStarting(true);
    setStartError('');
    try {
      const { sessionId } = await examsApi.start(id);
      navigate(`/exam/${sessionId}`);
    } catch (err) {
      setStartError(errorMessage(err));
      setStarting(false);
    }
  }

  const rules = [
    exam.sectionTimed
      ? 'Each section has its own timer. When a section ends, it closes and you move on to the next one. You can’t go back.'
      : 'You can move between questions freely and change answers until you submit.',
    'Your answers are saved automatically every few seconds.',
    exam.pauseOnDisconnect
      ? 'If your connection drops, reopen the test to carry on. Time spent offline isn’t counted.'
      : 'The timer keeps running even if you disconnect, so use a stable connection.',
    'The test is submitted automatically when time runs out.',
  ];

  return (
    <div className={styles.page}>
      {back}
      <header>
        <span className={styles.kind} data-kind={exam.kind}>
          {KIND_LABELS[exam.kind]}
        </span>
        <h1 className={styles.title}>{exam.title}</h1>
        {exam.description && (
          <p className={styles.subtitle}>{exam.description}</p>
        )}
      </header>

      <ul className={styles.facts}>
        <li>
          <span>Duration</span>
          <strong>{formatMinutes(exam.durationMinutes)}</strong>
        </li>
        <li>
          <span>Questions</span>
          <strong>{exam.questionCount}</strong>
        </li>
        <li>
          <span>Total marks</span>
          <strong>{exam.totalMarks}</strong>
        </li>
        {exam.passPercent !== null && (
          <li>
            <span>Pass mark</span>
            <strong>{exam.passPercent}%</strong>
          </li>
        )}
        <li>
          <span>Attempts</span>
          <strong>
            {exam.maxAttempts
              ? `${exam.attemptsUsed} / ${exam.maxAttempts}`
              : `${exam.attemptsUsed} (unlimited)`}
          </strong>
        </li>
      </ul>

      <section className={styles.panel}>
        <h2>Sections</h2>
        <div className={styles.tableWrap}>
          <table className={styles.sections}>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Questions</th>
                <th scope="col">Marks</th>
                {exam.sectionTimed && <th scope="col">Time</th>}
                <th scope="col">Wrong answer</th>
              </tr>
            </thead>
            <tbody>
              {exam.sections.map((s, i) => (
                <tr key={i}>
                  <td>
                    <strong>{s.title}</strong>
                    {s.description && (
                      <div className={styles.muted}>{s.description}</div>
                    )}
                  </td>
                  <td>
                    {s.questionCount}
                    <div className={styles.muted}>
                      {[
                        s.mcqCount && `${s.mcqCount} MCQ`,
                        s.codingCount && `${s.codingCount} coding`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </td>
                  <td>{s.marks}</td>
                  {exam.sectionTimed && (
                    <td>{formatMinutes(s.durationMinutes ?? 0)}</td>
                  )}
                  <td>
                    {s.negativeMarkPercent
                      ? `−${s.negativeMarkPercent}% of the marks`
                      : 'No penalty'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Instructions</h2>
        <Markdown>{exam.instructions}</Markdown>
        <h3 className={styles.rulesTitle}>How this test works</h3>
        <ul className={styles.rules}>
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      {exam.inProgressSessionId ? (
        <div className={styles.startBar}>
          <p>You have an attempt in progress.</p>
          <Link
            to={`/exam/${exam.inProgressSessionId}`}
            className={btn.primary}
          >
            Resume test
          </Link>
        </div>
      ) : exam.canStart ? (
        <div className={styles.startBar}>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read the instructions. I’ll take this test on my own,
              without outside help.
            </span>
          </label>
          <FormAlert>{startError}</FormAlert>
          <button
            type="button"
            className={btn.primary}
            disabled={!agreed || starting}
            onClick={() => void start()}
          >
            {starting ? 'Starting…' : 'Start test'}
          </button>
          <small className={styles.muted}>
            The timer starts as soon as you click Start.
          </small>
        </div>
      ) : (
        <div className={styles.startBar}>
          <p>You’ve used all your attempts for this test.</p>
        </div>
      )}
    </div>
  );
}
