import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Icon } from '../../../components/icons/Icon';
import { Markdown } from '../../../components/ui/Markdown';
import { LANGUAGE_LABELS } from '../../../features/questions/api';
import {
  fmtDuration,
  fmtMarks,
  fmtPercent,
  ordinal,
  scorecardsApi,
  type Scorecard,
  type ScorecardQuestion,
} from '../../../features/scorecards/api';
import { errorMessage } from '../../../lib/api';
import styles from './History.module.css';
import { BreakdownBars, HistoryChart, TimeChart } from './ScorecardCharts';

const OUTCOME: Record<string, { label: string; tone?: string }> = {
  correct: { label: 'Correct', tone: 'success' },
  partial: { label: 'Partly correct', tone: 'primary' },
  incorrect: { label: 'Incorrect', tone: 'danger' },
  unanswered: { label: 'Not answered' },
};

const VERDICT: Record<string, string> = {
  AC: 'Passed',
  WA: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RE: 'Runtime error',
  CE: 'Compilation error',
  IE: 'Judge error',
};

type Filter = 'all' | 'incorrect' | 'unanswered';

/** One attempt's scorecard (FRD §4.8): /history/:sessionId */
export function ScorecardPage() {
  const { sessionId = '' } = useParams();
  const [card, setCard] = useState<Scorecard | null>(null);
  const [error, setError] = useState('');
  const waiting =
    card?.gradingStatus === 'pending' || card?.gradingStatus === 'grading';

  useEffect(() => {
    let cancelled = false;
    scorecardsApi
      .get(sessionId)
      .then((c) => !cancelled && setCard(c))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Still grading: check again shortly.
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(
      () => scorecardsApi.get(sessionId).then(setCard, () => undefined),
      4000,
    );
    return () => window.clearTimeout(t);
  }, [waiting, sessionId, card]);

  const back = (
    <Link to="/history" className={styles.backLink}>
      <Icon name="arrowLeft" size={16} /> All attempts
    </Link>
  );
  if (error)
    return (
      <div className={styles.page}>
        {back}
        <p role="alert">{error}</p>
      </div>
    );
  if (!card) return <p aria-busy="true">Loading scorecard…</p>;

  const s = card.scorecard;
  return (
    <div className={styles.page}>
      {back}
      <header>
        <h1 className={styles.title}>{card.exam.title}</h1>
        <p className={styles.subtitle}>
          Attempt #{card.attemptNumber} · submitted{' '}
          {new Date(card.submittedAt).toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          {card.submitReason === 'time_expired' && ' (time ran out)'}
        </p>
      </header>

      {!s ? (
        <div className={styles.panel} aria-live="polite">
          {card.gradingStatus === 'failed'
            ? 'We couldn’t finish grading this attempt yet. We’ll retry, and your scorecard will appear here.'
            : 'Grading your answers… your scorecard will appear here in a moment.'}
        </div>
      ) : (
        <>
          <ul className={styles.tiles}>
            <li>
              <span>Score</span>
              <strong>
                {fmtMarks(s.score)} <small>/ {fmtMarks(s.maxScore)}</small>
              </strong>
              {s.score < 0 && (
                <small>Negative marking took this below zero.</small>
              )}
            </li>
            <li>
              <span>Percentage</span>
              <strong>{fmtPercent(s.percent)}</strong>
              {s.passed !== null && (
                <span
                  className={styles.badge}
                  data-tone={s.passed ? 'success' : 'danger'}
                >
                  <Icon name={s.passed ? 'check' : 'close'} size={12} />{' '}
                  {s.passed ? 'Passed' : 'Not passed'} (pass mark{' '}
                  {card.exam.passPercent}%)
                </span>
              )}
            </li>
            <li>
              <span>Percentile</span>
              <strong>{ordinal(s.percentile)}</strong>
              <small>
                {s.cohortSize <= 1
                  ? 'You’re the first to finish this test.'
                  : `Ranked among ${s.cohortSize} results: candidates’ first attempts${
                      card.attemptNumber > 1 ? ', plus this retake' : ''
                    }.`}
              </small>
            </li>
            <li>
              <span>Time</span>
              <strong>{fmtDuration(s.durationMs)}</strong>
              <small>{fmtDuration(s.timeSpentMs)} spent on questions</small>
            </li>
          </ul>

          <section className={styles.panel}>
            <h2>Sections</h2>
            <BreakdownBars
              caption="Score by section"
              rows={s.sections.map((x) => ({
                key: String(x.index),
                label: x.title,
                detail: `${x.correct} correct · ${x.partial} partly · ${x.incorrect} incorrect · ${x.unanswered} not answered · ${fmtDuration(x.timeSpentMs)}`,
                score: x.score,
                maxScore: x.maxScore,
                percent: x.percent,
              }))}
            />
          </section>

          <section className={styles.panel}>
            <h2>Topics</h2>
            <p className={styles.muted}>
              Weakest first: the topics to practise next.
            </p>
            <BreakdownBars
              caption="Score by topic"
              rows={s.topics.map((x) => ({
                key: x.topicId,
                label: x.name,
                detail: `${x.correct} of ${x.questionCount} fully correct`,
                score: x.score,
                maxScore: x.maxScore,
                percent: x.percent,
              }))}
            />
          </section>
        </>
      )}

      <section className={styles.panel}>
        <h2>Time per question</h2>
        <TimeChart questions={card.questions} />
        <details className={styles.tableToggle}>
          <summary>Show as a table</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Question</th>
                <th scope="col">Section</th>
                <th scope="col">Time</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {card.questions.map((q) => (
                <tr key={q.id}>
                  <td>{q.number}</td>
                  <td>{q.title}</td>
                  <td data-label="Section">{q.sectionTitle}</td>
                  <td data-label="Time">{fmtDuration(q.timeSpentMs)}</td>
                  <td data-label="Result">
                    {q.outcome ? OUTCOME[q.outcome].label : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {s && (
        <section className={styles.panel}>
          <h2>Your attempts at this test</h2>
          {card.history.length < 2 ? (
            <p className={styles.muted}>
              Take this test again to see how your score changes over attempts.{' '}
              <Link to={`/tests/${card.exam.id}`}>Try again</Link>
            </p>
          ) : (
            <HistoryChart
              history={card.history}
              passPercent={card.exam.passPercent}
            />
          )}
        </section>
      )}

      {s && <AnswerReview card={card} />}
    </div>
  );
}

function AnswerReview({ card }: { card: Scorecard }) {
  const [filter, setFilter] = useState<Filter>('all');
  if (card.exam.answerReview === 'none') {
    return (
      <section className={styles.panel}>
        <h2>Answer review</h2>
        <p className={styles.muted}>
          Answer review isn’t available for this test.
        </p>
      </section>
    );
  }
  const shown = card.questions.filter((q) =>
    filter === 'all'
      ? true
      : filter === 'unanswered'
        ? q.outcome === 'unanswered'
        : q.outcome === 'incorrect' || q.outcome === 'partial',
  );
  return (
    <section className={styles.panel}>
      <div className={styles.reviewHead}>
        <h2>Answer review</h2>
        <div
          className={styles.filters}
          role="group"
          aria-label="Show questions"
        >
          {(
            [
              ['all', 'All'],
              ['incorrect', 'Mistakes'],
              ['unanswered', 'Not answered'],
            ] as [Filter, string][]
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {card.exam.answerReview === 'own_answers' && (
        <p className={styles.muted}>
          This test shows your own answers only. Correct answers aren’t
          revealed.
        </p>
      )}
      {shown.length === 0 && (
        <p className={styles.muted}>Nothing to show here.</p>
      )}
      <ol className={styles.review}>
        {shown.map((q) => (
          <ReviewItem
            key={q.id}
            q={q}
            full={card.exam.answerReview === 'full'}
          />
        ))}
      </ol>
    </section>
  );
}

function ReviewItem({ q, full }: { q: ScorecardQuestion; full: boolean }) {
  const o = OUTCOME[q.outcome ?? 'unanswered'];
  return (
    <li className={styles.reviewItem}>
      <details>
        <summary>
          <span className={styles.qNum}>Q{q.number}</span>
          <span className={styles.qTitle}>{q.title}</span>
          <span className={styles.badge} data-tone={o.tone}>
            {o.label}
          </span>
          <span className={styles.qScore}>
            {q.score === null ? '—' : fmtMarks(q.score)} / {q.marks}
          </span>
        </summary>
        {q.review && (
          <div className={styles.reviewBody}>
            <Markdown>{q.review.body}</Markdown>
            {q.review.options && (
              <ul className={styles.options}>
                {q.review.options.map((opt) => (
                  <li
                    key={opt.id}
                    data-chosen={opt.chosen}
                    data-correct={opt.isCorrect === true}
                    data-wrong={opt.chosen && opt.isCorrect === false}
                  >
                    <span>{opt.text}</span>
                    <span className={styles.optTags}>
                      {opt.chosen && <em>Your answer</em>}
                      {opt.isCorrect && (
                        <em className={styles.correctTag}>
                          <Icon name="check" size={12} /> Correct answer
                        </em>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {q.review.code && <CodeReview code={q.review.code} full={full} />}
            {q.review.explanation && (
              <div className={styles.explanation}>
                <strong>Explanation</strong>
                <Markdown>{q.review.explanation}</Markdown>
              </div>
            )}
          </div>
        )}
      </details>
    </li>
  );
}

function CodeReview({
  code,
  full,
}: {
  code: NonNullable<NonNullable<ScorecardQuestion['review']>['code']>;
  full: boolean;
}) {
  if (!code.source)
    return (
      <p className={styles.muted}>You didn’t submit code for this question.</p>
    );
  return (
    <div className={styles.codeReview}>
      <div className={styles.codeMeta}>
        <strong>
          Your code{code.language && ` (${LANGUAGE_LABELS[code.language]})`}
        </strong>
        {code.verdict && (
          <span>
            <span data-verdict={code.verdict}>{VERDICT[code.verdict]}</span> ·{' '}
            {code.passedCount} of {code.totalCount} tests passed (hidden:{' '}
            {code.hiddenPassed} of {code.hiddenTotal})
          </span>
        )}
      </div>
      <pre className={styles.code}>{code.source}</pre>
      {full && code.compileOutput && (
        <pre className={styles.stderr}>{code.compileOutput}</pre>
      )}
      {code.samples.map((t, i) => (
        <div key={i} className={styles.sample}>
          <span>
            Example {i + 1}:{' '}
            <span data-verdict={t.verdict}>{VERDICT[t.verdict]}</span>
          </span>
          <div className={styles.io}>
            <div>
              <small>Input</small>
              <pre>{t.input || '(empty)'}</pre>
            </div>
            <div>
              <small>Expected</small>
              <pre>{t.expectedOutput}</pre>
            </div>
            <div>
              <small>Your output</small>
              <pre>{t.output || '(no output)'}</pre>
            </div>
          </div>
        </div>
      ))}
      {code.hiddenTotal > 0 && (
        <p className={styles.muted}>
          Hidden tests aren’t shown, only how many passed.
        </p>
      )}
    </div>
  );
}
