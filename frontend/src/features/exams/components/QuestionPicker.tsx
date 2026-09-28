import { useEffect, useState } from 'react';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { Dialog } from '../../../components/ui/Dialog';
import styles from '../../../pages/admin/Admin.module.css';
import { errorMessage } from '../../../lib/api';
import {
  DIFFICULTY_LABELS,
  questionsApi,
  type QuestionList,
  type Topic,
} from '../../questions/api';
import { DifficultyBadge } from '../../questions/components/QuestionBadges';
import type { PickedQuestion } from '../examForm';
import p from './QuestionPicker.module.css';

/**
 * Picks questions for an exam section from the live question bank (only
 * questions with a published version can be given to candidates).
 */
export function QuestionPicker({
  open,
  sectionTitle,
  alreadyInExam,
  onClose,
  onAdd,
}: {
  open: boolean;
  sectionTitle: string;
  alreadyInExam: Set<string>;
  onClose: () => void;
  onAdd: (questions: PickedQuestion[]) => void;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [filters, setFilters] = useState({
    search: '',
    type: '',
    topicId: '',
    difficulty: '',
    page: 1,
  });
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<QuestionList | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Map<string, PickedQuestion>>(
    () => new Map(),
  );

  useEffect(() => {
    if (open) questionsApi.topics().then(setTopics, () => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    questionsApi
      .list({ ...filters, live: 'true', pageSize: 20 })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, filters]);

  useEffect(() => {
    const t = setTimeout(
      () =>
        setFilters((f) =>
          f.search === search ? f : { ...f, search, page: 1 },
        ),
      300,
    );
    return () => clearTimeout(t);
  }, [search]);

  const setFilter = (name: 'type' | 'topicId' | 'difficulty', value: string) =>
    setFilters((f) => ({ ...f, [name]: value, page: 1 }));

  const close = () => {
    setSelected(new Map());
    onClose();
  };

  const toggle = (q: QuestionList['items'][number]) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(q.id)) next.delete(q.id);
      else
        next.set(q.id, {
          questionId: q.id,
          title: q.title,
          type: q.type,
          difficulty: q.difficulty,
          topicName: q.topic.name,
          marks: null,
          pinnedVersion: null,
          liveVersion: q.liveVersion,
        });
      return next;
    });

  return (
    <Dialog
      open={open}
      size="wide"
      title={`Add questions to “${sectionTitle}”`}
      onClose={close}
      actions={
        <>
          <button type="button" className={btn.secondary} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={selected.size === 0}
            onClick={() => {
              onAdd([...selected.values()]);
              close();
            }}
          >
            Add {selected.size || ''} question{selected.size === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p>Only published questions are listed.</p>
      <div className={p.filters}>
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
          value={filters.type}
          onChange={(e) => setFilter('type', e.target.value)}
        >
          <option value="">All types</option>
          <option value="mcq">MCQ</option>
          <option value="coding">Coding</option>
        </select>
        <select
          className={styles.select}
          aria-label="Topic"
          value={filters.topicId}
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
          value={filters.difficulty}
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
      {!result && !error && <p aria-busy="true">Loading…</p>}
      {result && result.items.length === 0 && (
        <p className={p.empty}>No published questions match.</p>
      )}
      {result && result.items.length > 0 && (
        <ul className={p.list}>
          {result.items.map((q) => {
            const added = alreadyInExam.has(q.id);
            return (
              <li key={q.id}>
                <label className={p.row} data-disabled={added}>
                  <input
                    type="checkbox"
                    checked={added || selected.has(q.id)}
                    disabled={added}
                    onChange={() => toggle(q)}
                  />
                  <span className={p.rowText}>
                    <strong>{q.title}</strong>
                    <small>
                      {q.type === 'mcq' ? 'MCQ' : 'Coding'} · {q.topic.name}
                      {added && ' · already in this exam'}
                    </small>
                  </span>
                  <DifficultyBadge difficulty={q.difficulty} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {result && result.totalPages > 1 && (
        <div className={styles.pager}>
          <span>
            Page {result.page} of {result.totalPages}
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            >
              Previous
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page >= result.totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
