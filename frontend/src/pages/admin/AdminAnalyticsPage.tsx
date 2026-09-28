import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import { formatDate } from '../../features/admin/api';
import {
  analyticsApi,
  FLAG_LABELS,
  type QuestionFlag,
  type QuestionStats,
} from '../../features/analytics/api';
import {
  DIFFICULTY_LABELS,
  questionsApi,
  type Topic,
} from '../../features/questions/api';
import { DifficultyBadge } from '../../features/questions/components/QuestionBadges';
import { fmtDuration } from '../../features/scorecards/api';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

type SortKey = 'attempts' | 'accuracy' | 'avg_time' | 'title';

const FLAG_TONE: Record<QuestionFlag, string | undefined> = {
  too_easy: 'primary',
  too_hard: 'danger',
  unused: undefined,
};

/** Question-quality analytics (FRD §4.9): /admin/analytics. Filters live in the URL. */
export function AdminAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<QuestionStats | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'refresh' | 'csv' | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [reload, setReload] = useState(0);
  const key = params.toString();
  const sort = (params.get('sort') ?? 'attempts') as SortKey;
  const dir = params.get('dir') ?? 'desc';

  const setFilter = (name: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: name === 'search' },
    );

  useEffect(() => {
    questionsApi.topics().then(setTopics, () => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    analyticsApi
      .questions(Object.fromEntries(new URLSearchParams(key)))
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [key, reload]);

  useEffect(() => {
    if (search === (params.get('search') ?? '')) return;
    const t = setTimeout(() => setFilter('search', search.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const sortBy = (k: SortKey) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const same = (prev.get('sort') ?? 'attempts') === k;
      next.set('sort', k);
      next.set(
        'dir',
        same && (prev.get('dir') ?? 'desc') === 'desc' ? 'asc' : 'desc',
      );
      return next;
    });

  async function refresh() {
    setBusy('refresh');
    setNotice('');
    try {
      await analyticsApi.refreshQuestions();
      setNotice('Refresh started. The numbers update in a few seconds.');
      window.setTimeout(() => setReload((n) => n + 1), 3000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy('csv');
    try {
      await analyticsApi.questionsCsv(
        Object.fromEntries(new URLSearchParams(key)),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const header = (k: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={
        sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        className={styles.linkish}
        onClick={() => sortBy(k)}
      >
        {label}
        {sort === k && (dir === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </th>
  );

  return (
    <div className={styles.page}>
      <header className={styles.sectionHead}>
        <div>
          <h1 className={styles.title}>Question analytics</h1>
          <p className={styles.subtitle}>
            How each live question performs in graded attempts.
            {result?.computedAt && ` Updated ${formatDate(result.computedAt)}.`}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => void refresh()}
            disabled={busy !== null}
          >
            {busy === 'refresh' ? 'Starting…' : 'Refresh now'}
          </button>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => void exportCsv()}
            disabled={busy !== null}
          >
            <Icon name="file" size={16} />{' '}
            {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Flag">
        {(['', 'too_hard', 'too_easy', 'unused'] as const).map((f) => (
          <button
            key={f || 'all'}
            type="button"
            role="tab"
            aria-selected={(params.get('flag') ?? '') === f}
            className={
              (params.get('flag') ?? '') === f ? styles.tabActive : styles.tab
            }
            onClick={() => setFilter('flag', f)}
          >
            {f ? FLAG_LABELS[f] : 'All questions'}
          </button>
        ))}
      </div>

      <div className={styles.filters} role="search">
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            type="search"
            placeholder="Search by title"
            aria-label="Search questions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.select}
          aria-label="Type"
          value={params.get('type') ?? ''}
          onChange={(e) => setFilter('type', e.target.value)}
        >
          <option value="">All types</option>
          <option value="mcq">MCQ</option>
          <option value="coding">Coding</option>
        </select>
        <select
          className={styles.select}
          aria-label="Topic"
          value={params.get('topicId') ?? ''}
          onChange={(e) => setFilter('topicId', e.target.value)}
        >
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Difficulty"
          value={params.get('difficulty') ?? ''}
          onChange={(e) => setFilter('difficulty', e.target.value)}
        >
          <option value="">Any difficulty</option>
          {Object.entries(DIFFICULTY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p aria-busy="true">Loading…</p>}
      {result && (
        <p className={styles.muted} style={{ margin: 0, fontSize: '0.875rem' }}>
          {result.total} question{result.total === 1 ? '' : 's'}. Flags need at
          least {result.thresholds.minAttempts} answers: too easy ≥{' '}
          {result.thresholds.tooEasy}% fully correct, too hard ≤{' '}
          {result.thresholds.tooHard}%.
        </p>
      )}
      {result &&
        (result.rows.length === 0 ? (
          <div className={`${styles.card} ${styles.empty}`}>
            <p className={styles.muted}>No questions match these filters.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                {header('title', 'Question')}
                {header('attempts', 'Attempts')}
                {header('accuracy', 'Fully correct')}
                <th scope="col">Avg score</th>
                {header('avg_time', 'Avg time')}
                <th scope="col">Flags</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.questionId}>
                  <td>
                    <div className={styles.userCell}>
                      <Link to={`/admin/questions/${r.questionId}`}>
                        {r.title}
                      </Link>
                      <span>
                        {r.type === 'mcq' ? 'MCQ' : 'Coding'} · {r.topic.name} ·{' '}
                        <DifficultyBadge difficulty={r.difficulty} />
                      </span>
                    </div>
                  </td>
                  <td data-label="Attempts">
                    {r.attempts}
                    {r.attempts > r.answered && (
                      <span className={styles.muted}>
                        {' '}
                        ({r.attempts - r.answered} skipped)
                      </span>
                    )}
                  </td>
                  <td data-label="Fully correct">
                    {r.accuracy === null ? '—' : `${r.accuracy}%`}
                  </td>
                  <td data-label="Avg score">
                    {r.avgScore === null ? '—' : `${r.avgScore}%`}
                  </td>
                  <td data-label="Avg time">
                    {r.avgTimeMs === null ? '—' : fmtDuration(r.avgTimeMs)}
                  </td>
                  <td data-label="Flags">
                    <div className={styles.badges} style={{ marginTop: 0 }}>
                      {r.flags.map((f) => (
                        <span
                          key={f}
                          className={styles.badge}
                          data-tone={FLAG_TONE[f]}
                        >
                          {FLAG_LABELS[f]}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
