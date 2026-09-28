import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import {
  analyticsApi,
  STRENGTH_LABELS,
  type Insights,
  type Strength,
} from '../../../features/analytics/api';
import {
  RadarChart,
  TrendLine,
} from '../../../features/analytics/components/Charts';
import { KIND_LABELS } from '../../../features/exams/api';
import { DIFFICULTY_LABELS } from '../../../features/questions/api';
import { fmtDuration, fmtPercent } from '../../../features/scorecards/api';
import { errorMessage } from '../../../lib/api';
import styles from '../history/History.module.css';
import { BreakdownBars } from '../history/ScorecardCharts';

const STRENGTH_TONE: Record<Strength, string | undefined> = {
  strong: 'success',
  developing: 'primary',
  weak: 'danger',
  not_enough_data: undefined,
};

/** Candidate insights (FRD §4.9): /insights */
export function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    analyticsApi
      .insights()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function exportCsv() {
    setExporting(true);
    try {
      await analyticsApi.insightsCsv();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p aria-busy="true">Loading your insights…</p>;

  const t = data.totals;
  const weakest = data.topics
    .filter((x) => x.strength === 'weak' || x.strength === 'developing')
    .slice(-3)
    .reverse();

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Insights</h1>
        <p className={styles.subtitle}>
          Your strengths and weak spots across every test you’ve completed.
        </p>
      </header>

      {t.testsCompleted === 0 ? (
        <div className={styles.empty}>
          <p>Complete a mock test to see your strengths and weaknesses here.</p>
          <Link to="/tests" className={btn.primary}>
            Browse mock tests
          </Link>
        </div>
      ) : (
        <>
          <ul className={styles.tiles}>
            <li>
              <span>Tests completed</span>
              <strong>{t.testsCompleted}</strong>
              <small>{fmtDuration(t.timeSpentMs)} on questions</small>
            </li>
            <li>
              <span>Average score</span>
              <strong>
                {t.averagePercent === null ? '—' : fmtPercent(t.averagePercent)}
              </strong>
              {t.bestPercent !== null && (
                <small>Best: {fmtPercent(t.bestPercent)}</small>
              )}
            </li>
            <li>
              <span>Questions answered</span>
              <strong>{t.questionsAnswered}</strong>
              <small>{fmtPercent(t.overall.accuracy)} fully correct</small>
            </li>
            <li>
              <span>Overall mastery</span>
              <strong>{fmtPercent(t.overall.mastery)}</strong>
              <small>of the marks available</small>
            </li>
          </ul>

          <section className={styles.panel}>
            <div className={styles.reviewHead}>
              <h2>Strengths by topic</h2>
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
            {data.topics.length >= 3 ? (
              <RadarChart
                label="Mastery by topic"
                axes={data.topics.map((x) => ({
                  key: x.topicId,
                  label: x.name,
                  value: x.mastery,
                  detail: `${x.correct} of ${x.questions} fully correct · ${STRENGTH_LABELS[x.strength]}`,
                }))}
              />
            ) : (
              <BreakdownBars
                caption="Mastery by topic"
                rows={data.topics.map((x) => ({
                  key: x.topicId,
                  label: x.name,
                  score: x.correct,
                  maxScore: x.questions,
                  percent: x.mastery,
                }))}
              />
            )}
            <table className={styles.table}>
              <caption className="sr-only">Mastery by topic</caption>
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col">Mastery</th>
                  <th scope="col">Fully correct</th>
                  <th scope="col">Avg time</th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {data.topics.map((x) => (
                  <tr key={x.topicId}>
                    <td>
                      <strong>{x.name}</strong>
                    </td>
                    <td data-label="Mastery">{fmtPercent(x.mastery)}</td>
                    <td data-label="Fully correct">
                      {x.correct} / {x.questions}
                    </td>
                    <td data-label="Avg time">{fmtDuration(x.avgTimeMs)}</td>
                    <td data-label="Level">
                      <span
                        className={styles.badge}
                        data-tone={STRENGTH_TONE[x.strength]}
                      >
                        {STRENGTH_LABELS[x.strength]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.muted}>
              Mastery is the share of available marks you earned (a question
              with negative marking counts as zero). Topics need at least 3
              questions to get a level.
            </p>
          </section>

          <section className={styles.panel}>
            <h2>By difficulty</h2>
            <BreakdownBars
              caption="Mastery by difficulty"
              rows={data.difficulty
                .filter((d) => d.questions > 0)
                .map((d) => ({
                  key: d.difficulty,
                  label: DIFFICULTY_LABELS[d.difficulty],
                  detail: `${d.correct} of ${d.questions} fully correct · avg ${fmtDuration(d.avgTimeMs)}`,
                  score: d.correct,
                  maxScore: d.questions,
                  percent: d.mastery,
                }))}
            />
          </section>

          <section className={styles.panel}>
            <h2>Score over time</h2>
            {data.trend.length < 2 ? (
              <p className={styles.muted}>
                Complete another test to see your trend.
              </p>
            ) : (
              <TrendLine
                points={data.trend.map((p) => ({
                  key: p.sessionId,
                  label: `${p.title} (attempt #${p.attemptNumber})`,
                  date: p.submittedAt,
                  value: p.percent,
                }))}
              />
            )}
          </section>
        </>
      )}

      {data.recommendations.length > 0 && (
        <section className={styles.panel}>
          <h2>Take next</h2>
          {weakest.length > 0 && (
            <p className={styles.muted}>
              Picked to practise your weakest topics:{' '}
              {weakest.map((x) => x.name).join(', ')}.
            </p>
          )}
          <ul className={styles.attemptsGrid}>
            {data.recommendations.map((r) => (
              <li key={r.examId}>
                <strong>{r.title}</strong>
                <span className={styles.muted}>
                  {KIND_LABELS[r.kind]} · {r.questionCount} questions ·{' '}
                  {r.durationMinutes} min · {DIFFICULTY_LABELS[r.difficulty]}
                </span>
                {r.weakTopics.length > 0 && (
                  <span className={styles.badge} data-tone="primary">
                    Practises {r.weakTopics.join(', ')}
                  </span>
                )}
                <Link to={`/tests/${r.examId}`} className={btn.primary}>
                  View test
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
