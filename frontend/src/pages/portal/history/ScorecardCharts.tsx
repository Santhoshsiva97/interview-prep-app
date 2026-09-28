import { useId, useState } from 'react';
import {
  fmtDuration,
  fmtMarks,
  fmtPercent,
  type Scorecard,
  type ScorecardQuestion,
} from '../../../features/scorecards/api';
import styles from './History.module.css';

/**
 * Small single-series charts for the scorecard. One hue (the primary token)
 * so nothing relies on telling colours apart; every mark has a hover/focus
 * tooltip and each chart has a table next to or under it.
 */

/** Horizontal percentage bars as a table: label | bar | value. */
export function BreakdownBars({
  caption,
  rows,
}: {
  caption: string;
  rows: {
    key: string;
    label: string;
    detail?: string;
    score: number;
    maxScore: number;
    percent: number;
  }[];
}) {
  return (
    <table className={styles.bars}>
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Share of marks</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">
              {r.label}
              {r.detail && <small>{r.detail}</small>}
            </th>
            <td className={styles.barCell}>
              <span
                className={styles.barTrack}
                title={`${r.label}: ${fmtMarks(r.score)} of ${fmtMarks(r.maxScore)} marks (${fmtPercent(r.percent)})`}
              >
                <span
                  className={styles.barFill}
                  style={{ width: `${r.percent}%` }}
                />
              </span>
            </td>
            <td className={styles.barValue}>
              <strong>{fmtPercent(r.percent)}</strong>
              <small>
                {fmtMarks(r.score)} / {fmtMarks(r.maxScore)}
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  correct: 'Correct',
  partial: 'Partly correct',
  incorrect: 'Incorrect',
  unanswered: 'Not answered',
};

/** Time spent per question (columns), with the average as a dashed line. */
export function TimeChart({ questions }: { questions: ScorecardQuestion[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 640;
  const H = 180;
  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const max = niceMax(Math.max(0, ...questions.map((q) => q.timeSpentMs)));
  const avg =
    questions.reduce((a, q) => a + q.timeSpentMs, 0) /
    Math.max(1, questions.length);
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const band = plotW / Math.max(1, questions.length);
  const barW = Math.max(4, Math.min(28, band - 4));
  const y = (ms: number) => pad.top + plotH - (ms / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = hover === null ? null : questions[hover];

  return (
    <figure className={styles.figure}>
      <div className={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.chart}
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>
            Time spent per question. Average {fmtDuration(avg)}.
          </title>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(t)}
                y2={y(t)}
                className={styles.grid}
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                className={styles.axisLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {fmtDuration(t)}
              </text>
            </g>
          ))}
          {questions.map((q, i) => {
            const x = pad.left + i * band + (band - barW) / 2;
            const h = Math.max(
              q.timeSpentMs > 0 ? 2 : 0,
              pad.top + plotH - y(q.timeSpentMs),
            );
            return (
              <g
                key={q.id}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`Question ${q.number}: ${fmtDuration(q.timeSpentMs)}`}
              >
                {/* Hit target wider than the bar. */}
                <rect
                  x={pad.left + i * band}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                <rect
                  x={x}
                  y={pad.top + plotH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(4, barW / 2)}
                  className={hover === i ? styles.barActive : styles.barMark}
                />
                {(questions.length <= 20 || i % 5 === 0) && (
                  <text
                    x={x + barW / 2}
                    y={H - 10}
                    className={styles.axisLabel}
                    textAnchor="middle"
                  >
                    {q.number}
                  </text>
                )}
              </g>
            );
          })}
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={y(avg)}
            y2={y(avg)}
            className={styles.avgLine}
          />
          <text
            x={W - pad.right}
            y={y(avg) - 5}
            className={styles.axisLabel}
            textAnchor="end"
          >
            avg {fmtDuration(avg)}
          </text>
        </svg>
        {hovered && (
          <div className={styles.tooltip} role="status">
            <strong>
              Q{hovered.number}. {hovered.title}
            </strong>
            <span>
              {fmtDuration(hovered.timeSpentMs)} · {hovered.sectionTitle}
              {hovered.outcome && ` · ${OUTCOME_LABEL[hovered.outcome]}`}
            </span>
          </div>
        )}
      </div>
      <figcaption className={styles.muted}>
        Question number along the bottom. Hover or focus a bar for details.
      </figcaption>
    </figure>
  );
}

/** Percentage across this candidate's attempts at the exam; the current one highlighted. */
export function HistoryChart({
  history,
  passPercent,
}: {
  history: Scorecard['history'];
  passPercent: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 640;
  const H = 200;
  const pad = { top: 18, right: 24, bottom: 30, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const x = (i: number) =>
    pad.left +
    (history.length === 1 ? plotW / 2 : (i * plotW) / (history.length - 1));
  const y = (p: number) => pad.top + plotH - (p / 100) * plotH;
  const path = history
    .map((h, i) => `${i ? 'L' : 'M'}${x(i)},${y(h.percent)}`)
    .join(' ');
  const hovered = hover === null ? null : history[hover];

  return (
    <figure className={styles.figure}>
      <div className={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.chart}
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>
            Score by attempt:{' '}
            {history
              .map((h) => `attempt ${h.attemptNumber} ${fmtPercent(h.percent)}`)
              .join(', ')}
          </title>
          {[0, 50, 100].map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(t)}
                y2={y(t)}
                className={styles.grid}
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                className={styles.axisLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {t}%
              </text>
            </g>
          ))}
          {passPercent !== null && (
            <g>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(passPercent)}
                y2={y(passPercent)}
                className={styles.avgLine}
              />
              <text
                x={W - pad.right}
                y={y(passPercent) - 5}
                className={styles.axisLabel}
                textAnchor="end"
              >
                pass {passPercent}%
              </text>
            </g>
          )}
          <path d={path} className={styles.line} />
          {history.map((h, i) => (
            <g
              key={h.sessionId}
              tabIndex={0}
              aria-label={`Attempt ${h.attemptNumber}: ${fmtPercent(h.percent)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <circle cx={x(i)} cy={y(h.percent)} r={14} fill="transparent" />
              <circle
                cx={x(i)}
                cy={y(h.percent)}
                r={h.current ? 6 : 4.5}
                className={h.current ? styles.dotCurrent : styles.dot}
              />
              <text
                x={x(i)}
                y={H - 10}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                #{h.attemptNumber}
              </text>
              {h.current && (
                <text
                  x={x(i)}
                  y={y(h.percent) - 12}
                  className={styles.pointLabel}
                  textAnchor="middle"
                >
                  {fmtPercent(h.percent)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hovered && (
          <div className={styles.tooltip} role="status">
            <strong>
              Attempt #{hovered.attemptNumber}
              {hovered.current && ' (this one)'}
            </strong>
            <span>
              {fmtPercent(hovered.percent)} · {fmtMarks(hovered.score)} marks ·{' '}
              {new Date(hovered.submittedAt).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Rounds an axis maximum up to a readable duration (10 s, 30 s, 1 min, 2 min…). */
function niceMax(ms: number): number {
  const steps = [10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200];
  const seconds = Math.ceil(ms / 1000);
  return (
    (steps.find((st) => st >= seconds) ?? Math.ceil(seconds / 3600) * 3600) *
    1000
  );
}
