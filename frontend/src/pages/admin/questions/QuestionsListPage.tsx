import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { formatDate } from '../../../features/admin/api';
import { useAuth } from '../../../features/auth/useAuth';
import {
  DIFFICULTY_LABELS,
  questionsApi,
  STATUS_LABELS,
  type QuestionList,
  type QuestionStatus,
  type Topic,
} from '../../../features/questions/api';
import {
  DifficultyBadge,
  StatusBadge,
} from '../../../features/questions/components/QuestionBadges';
import { errorMessage } from '../../../lib/api';
import styles from '../Admin.module.css';
import q from './Questions.module.css';

const TABS: { status: QuestionStatus | ''; label: string }[] = [
  { status: '', label: 'All' },
  { status: 'pending_review', label: 'Review queue' },
  { status: 'draft', label: 'Drafts' },
  { status: 'rejected', label: 'Changes requested' },
  { status: 'published', label: 'Published' },
  { status: 'archived', label: 'Archived' },
];

/** Question bank list (FRD §4.11). Filters live in the URL. */
export function QuestionsListPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<QuestionList | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const key = params.toString();
  const status = (params.get('status') ?? '') as QuestionStatus | '';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

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
    questionsApi.topics().then(setTopics, () => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    questionsApi
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
          <h1 className={styles.title}>Question bank</h1>
          <p className={styles.subtitle}>
            Write, review and publish MCQ and coding questions.
            {isAdmin && result?.statusCounts.pending_review
              ? ` ${result.statusCounts.pending_review} waiting for your review.`
              : ''}
          </p>
        </div>
        <div className={q.headerActions}>
          <Link to="/admin/questions/import" className={btn.secondary}>
            <Icon name="upload" size={18} /> Bulk upload
          </Link>
          <Link to="/admin/questions/new?type=mcq" className={btn.primary}>
            + New MCQ
          </Link>
          <Link to="/admin/questions/new?type=coding" className={btn.primary}>
            + New coding
          </Link>
        </div>
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
            placeholder="Search title or external id"
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

      {error && <p role="alert">{error}</p>}
      {!result && !error && <p aria-busy="true">Loading questions…</p>}
      {result &&
        (result.items.length === 0 ? (
          <div className={`${styles.card} ${styles.empty}`}>
            <p className={styles.muted}>
              {status
                ? `No ${STATUS_LABELS[status].toLowerCase()} questions match.`
                : 'No questions match these filters.'}
            </p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Type</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Status</th>
                <th scope="col">Version</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.userCell}>
                      <Link to={`/admin/questions/${item.id}`}>
                        {item.title}
                      </Link>
                      <span>
                        {item.topic.name}
                        {item.tags.length > 0 &&
                          ` · ${item.tags.map((t) => t.name).join(', ')}`}
                      </span>
                    </div>
                  </td>
                  <td data-label="Type">
                    {item.type === 'mcq' ? 'MCQ' : 'Coding'}
                  </td>
                  <td data-label="Difficulty">
                    <DifficultyBadge difficulty={item.difficulty} />
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={item.status} />
                    {item.liveVersion && item.status !== 'published' && (
                      <div
                        className={styles.muted}
                        style={{ fontSize: '0.8125rem', marginTop: 4 }}
                      >
                        v{item.liveVersion} is live
                      </div>
                    )}
                  </td>
                  <td data-label="Version">v{item.currentVersion}</td>
                  <td data-label="Updated">{formatDate(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {result && result.total > 0 && (
        <nav className={styles.pager} aria-label="Pagination">
          <span>
            Page {result.page} of {result.totalPages} · {result.total} question
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
