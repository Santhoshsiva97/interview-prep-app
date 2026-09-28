import { useId, useState } from 'react';
import styles from './Charts.module.css';

/**
 * Dependency-free SVG charts for analytics views. One hue (the primary
 * token); every mark is focusable with a tooltip, and each chart is paired
 * with a table on the page (the accessible and exportable view).
 */

const pctLabel = (n: number) => `${Math.round(n)}%`;

/** Mastery by topic on a 0–100 radar. Needs at least 3 axes. */
export function RadarChart({
  axes,
  label,
}: {
  axes: { key: string; label: string; value: number; detail: string }[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  // Wider than tall: side labels need room.
  const W = 560;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2;
  const r = 120;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
  const point = (i: number, v: number) => {
    const a = angle(i);
    const d = (Math.max(0, v) / 100) * r;
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)] as const;
  };
  const clamp = (v: number) => Math.min(100, v);
  const ring = (v: number) =>
    axes.map((_, i) => point(i, v).join(',')).join(' ');
  const shape = axes
    .map((a, i) => point(i, clamp(a.value)).join(','))
    .join(' ');
  const hovered = hover === null ? null : axes[hover];

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.radar}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>
          {label}:{' '}
          {axes.map((a) => `${a.label} ${pctLabel(a.value)}`).join(', ')}
        </title>
        {[25, 50, 75, 100].map((v) => (
          <polygon key={v} points={ring(v)} className={styles.grid} />
        ))}
        {axes.map((a, i) => {
          const [x, y] = point(i, 100);
          const [lx, ly] = point(i, 116);
          const anchor =
            Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
          return (
            <g key={a.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} className={styles.grid} />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                className={styles.axisLabel}
              >
                {a.label.length > 16 ? `${a.label.slice(0, 15)}…` : a.label}
              </text>
            </g>
          );
        })}
        {/* Ring values sit just left of the top axis, clear of its label. */}
        <text
          x={cx - 5}
          y={cy - r / 2}
          textAnchor="end"
          className={styles.tick}
        >
          50%
        </text>
        <text
          x={cx - 5}
          y={cy - r + 10}
          textAnchor="end"
          className={styles.tick}
        >
          100%
        </text>
        <polygon points={shape} className={styles.area} />
        {axes.map((a, i) => {
          const [x, y] = point(i, clamp(a.value));
          return (
            <g
              key={a.key}
              tabIndex={0}
              aria-label={`${a.label}: ${pctLabel(a.value)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <circle cx={x} cy={y} r={14} fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={hover === i ? 6 : 4.5}
                className={styles.dot}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className={styles.tooltip} role="status">
          <strong>{hovered.label}</strong>
          <span>
            {pctLabel(hovered.value)} · {hovered.detail}
          </span>
        </div>
      )}
    </div>
  );
}

/** A small daily column chart (one metric), for small multiples. */
export function DailyColumns({
  title,
  points,
  format = (v) => String(v),
  headline,
}: {
  title: string;
  points: { day: string; value: number | null }[];
  format?: (v: number) => string;
  /** Shown when nothing is hovered; defaults to the period total. */
  headline?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 300;
  const H = 110;
  const pad = { top: 8, right: 4, bottom: 18, left: 4 };
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values);
  const plotH = H - pad.top - pad.bottom;
  const band = (W - pad.left - pad.right) / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(14, band - 2));
  const total = values.reduce((a, b) => a + b, 0);
  const hovered = hover === null ? null : points[hover];
  const shortDay = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <figure className={styles.small}>
      <figcaption className={styles.smallHead}>
        <span id={titleId}>{title}</span>
        <strong>
          {hovered
            ? hovered.value === null
              ? '—'
              : format(hovered.value)
            : (headline ?? format(total))}
        </strong>
        <small>
          {hovered ? shortDay(hovered.day) : `last ${points.length} days`}
        </small>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={pad.left}
          x2={W - pad.right}
          y1={H - pad.bottom}
          y2={H - pad.bottom}
          className={styles.grid}
        />
        {points.map((p, i) => {
          const v = p.value ?? 0;
          const h = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
          const x = pad.left + i * band + (band - barW) / 2;
          return (
            <g
              key={p.day}
              tabIndex={0}
              aria-label={`${shortDay(p.day)}: ${p.value === null ? 'no data' : format(v)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
              />
              <rect
                x={x}
                y={H - pad.bottom - h}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 2)}
                className={hover === i ? styles.barActive : styles.bar}
              />
            </g>
          );
        })}
        <text x={pad.left} y={H - 4} className={styles.tick}>
          {points[0] && shortDay(points[0].day)}
        </text>
        <text
          x={W - pad.right}
          y={H - 4}
          textAnchor="end"
          className={styles.tick}
        >
          {points.at(-1) && shortDay(points.at(-1)!.day)}
        </text>
      </svg>
    </figure>
  );
}

/** Percentage over time (one point per completed test). */
export function TrendLine({
  points,
}: {
  points: { key: string; label: string; date: string; value: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 640;
  const H = 200;
  const pad = { top: 16, right: 20, bottom: 26, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const x = (i: number) =>
    pad.left +
    (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => pad.top + plotH - (v / 100) * plotH;
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`)
    .join(' ');
  const hovered = hover === null ? null : points[hover];

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>
          Score by test over time:{' '}
          {points.map((p) => `${p.label} ${pctLabel(p.value)}`).join(', ')}
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
              textAnchor="end"
              dominantBaseline="middle"
              className={styles.tick}
            >
              {t}%
            </text>
          </g>
        ))}
        <path d={path} className={styles.line} />
        {points.map((p, i) => (
          <g
            key={p.key}
            tabIndex={0}
            aria-label={`${p.label}: ${pctLabel(p.value)}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <circle cx={x(i)} cy={y(p.value)} r={14} fill="transparent" />
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={hover === i ? 6 : 4.5}
              className={styles.dot}
            />
          </g>
        ))}
        <text x={pad.left} y={H - 6} className={styles.tick}>
          {points[0] && new Date(points[0].date).toLocaleDateString()}
        </text>
        <text
          x={W - pad.right}
          y={H - 6}
          textAnchor="end"
          className={styles.tick}
        >
          {points.at(-1) && new Date(points.at(-1)!.date).toLocaleDateString()}
        </text>
      </svg>
      {hovered && (
        <div className={styles.tooltip} role="status">
          <strong>{hovered.label}</strong>
          <span>
            {pctLabel(hovered.value)} ·{' '}
            {new Date(hovered.date).toLocaleDateString()}
          </span>
        </div>
      )}
    </div>
  );
}
