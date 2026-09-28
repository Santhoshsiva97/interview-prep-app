import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { formatDate } from '../../../features/admin/api';
import {
  adminExamsApi,
  EXAM_STATUS_LABELS,
  formatMinutes,
  KIND_LABELS,
  type ExamList,
  type ExamStatus,
} from '../../../features/exams/api';
import { errorMessage } from '../../../lib/api';
import styles from '../Admin.module.css';
import q from '../questions/Questions.module.css';

const TABS: { status: ExamStatus | ''; label: string }[] = [
  { status: '', label: 'All' },
  { status: 'draft', label: 'Drafts' },
  { status: 'published', label: 'Published' },
  { status: 'archived', label: 'Archived' },
];

const STATUS_TONE: Record<ExamStatus, string | undefined> = {
  draft: undefined,
  published: 'success',
  archived: undefined,
};

/** Exam & interview templates (FRD §4.6). Filters live in the URL. */
export function ExamsListPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<ExamList | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const key = params.toString();
  const status = (params.get('status') ?? '') as ExamStatus | '';

  const setFilter = (name: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        if (name !== 'page') next.delete('page');
        return next;
      },
      { replace: name === 'search' },
    );

  useEffect(() => {
    let cancelled = false;
    adminExamsApi
      .list(Object.fromEntries(new URLSearchParams(key)))
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (search === (params.get('search') ?? '')) return;
    const t = setTimeout(() => setFilter('search', search.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const total = Object.values(result?.statusCounts ?? {}).reduce(
    (a, b) => a + (b ?? 0),
    0,
  );

  return (
    <div className={styles.page}>
      <header className={q.headerRow}>
        <div>
          <h1 className={styles.title}>Exams & interviews</h1>
          <p className={styles.subtitle}>
            Build mock tests and interview templates from published questions.
          </p>
        </div>
        <Link to="/admin/exams/new" className={btn.primary}>
          + New exam
        </Link>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const count = t.status ? result?.statusCounts[t.status] : total;
          return (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={status === t.status}
              className={status === t.status ? styles.tabActive : styles.tab}
              onClick={() => setFilter('status', t.status)}
            >
              {t.label}
              {count ? <span className={q.count}>{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className={styles.filters} role="search">
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            type="search"
            placeholder="Search by title"
            aria-label="Search exams"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.select}
          aria-label="Type"
          value={params.get('kind') ?? ''}
          onChange={(e) => setFilter('kind', e.target.value)}
        >
          <option value="">All types</option>
          {Object.entries(KIND_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}
      {!result && !error && <p aria-busy="true">Loading exams…</p>}
      {result &&
        (result.items.length === 0 ? (
          <div className={`${styles.card} ${styles.empty}`}>
            <p className={styles.muted}>
              {total === 0
                ? 'No exams yet. Create one to get started.'
                : 'No exams match these filters.'}
            </p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Exam</th>
                <th scope="col">Status</th>
                <th scope="col">Questions</th>
                <th scope="col">Duration</th>
                <th scope="col">Attempts</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className={styles.userCell}>
                      <Link to={`/admin/exams/${e.id}`}>{e.title}</Link>
                      <span>
                        {KIND_LABELS[e.kind]}
                        {e.sectionTimed && ' · timed sections'}
                      </span>
                    </div>
                  </td>
                  <td data-label="Status">
                    <span
                      className={styles.badge}
                      data-tone={STATUS_TONE[e.status]}
                    >
                      {EXAM_STATUS_LABELS[e.status]}
                    </span>
                  </td>
                  <td data-label="Questions">
                    {e.questionCount} in {e.sectionCount} section
                    {e.sectionCount === 1 ? '' : 's'}
                  </td>
                  <td data-label="Duration">
                    {formatMinutes(e.durationMinutes)}
                  </td>
                  <td data-label="Attempts">{e.attemptCount}</td>
                  <td data-label="Updated">{formatDate(e.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {result && result.total > 0 && (
        <nav className={styles.pager} aria-label="Pagination">
          <span>
            Page {result.page} of {result.totalPages} · {result.total} exam
            {result.total === 1 ? '' : 's'}
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page <= 1}
              onClick={() => setFilter('page', String(result.page - 1))}
            >
              <Icon name="chevronLeft" size={16} /> Previous
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page >= result.totalPages}
              onClick={() => setFilter('page', String(result.page + 1))}
            >
              Next <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
