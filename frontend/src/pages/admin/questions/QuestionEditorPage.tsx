import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormField';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { Dialog } from '../../../components/ui/Dialog';
import { formatDate } from '../../../features/admin/api';
import { useAuth } from '../../../features/auth/useAuth';
import {
  DIFFICULTY_LABELS,
  LANGUAGE_LABELS,
  LANGUAGES,
  questionsApi,
  type Difficulty,
  type FieldProblem,
  type QuestionDetail,
  type QuestionType,
  type QuestionVersion,
  type Tag,
  type Topic,
  type WorkflowAction,
} from '../../../features/questions/api';
import {
  DifficultyBadge,
  StatusBadge,
} from '../../../features/questions/components/QuestionBadges';
import {
  blankForm,
  formFromQuestion,
  formKey,
  formToInput,
  type QuestionFormState,
} from '../../../features/questions/questionForm';
import { ApiError, errorMessage } from '../../../lib/api';
import styles from '../Admin.module.css';
import q from './Questions.module.css';

/** Create (/admin/questions/new?type=…) or edit (/admin/questions/:id) a question. */
export function QuestionEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      questionsApi.topics(),
      questionsApi.tags(),
      id ? questionsApi.get(id) : null,
    ])
      .then(([t, g, qd]) => {
        if (cancelled) return;
        setTopics(t);
        setTags(g);
        setQuestion(qd);
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Link to="/admin/questions" className={styles.backLink}>
      <Icon name="arrowLeft" size={16} /> Question bank
    </Link>
  );
  if (error)
    return (
      <div className={styles.page}>
        {back}
        <p role="alert">{error}</p>
      </div>
    );
  if (!topics || (id && !question)) return <p aria-busy="true">Loading…</p>;

  const type: QuestionType =
    question?.type ?? (params.get('type') === 'coding' ? 'coding' : 'mcq');
  return (
    <div className={styles.page}>
      {back}
      <Editor
        key={question ? question.id : `new:${type}`}
        type={type}
        question={question}
        topics={topics}
        tags={tags}
        onSaved={setQuestion}
      />
    </div>
  );
}

interface EditorProps {
  type: QuestionType;
  question: QuestionDetail | null;
  topics: Topic[];
  tags: Tag[];
  onSaved: (q: QuestionDetail) => void;
}

function Editor({ type, question, topics, tags, onSaved }: EditorProps) {
  const navigate = useNavigate();
  // Last saved state; "dirty" compares against it.
  const [initial, setInitial] = useState(() =>
    question ? formFromQuestion(question) : blankForm(type),
  );
  const [form, setForm] = useState<QuestionFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = formKey(form) !== formKey(initial);

  const set = <K extends keyof QuestionFormState>(
    key: K,
    value: QuestionFormState[K],
  ) => {
    setNotice('');
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setProblems([]);
    try {
      if (!question) {
        const created = await questionsApi.create(formToInput(form));
        navigate(`/admin/questions/${created.id}`, { replace: true });
        return;
      }
      const { question: saved, changed } = await questionsApi.update(
        question.id,
        formToInput(form),
      );
      const next = formFromQuestion(saved);
      setInitial(next);
      setForm(next);
      onSaved(saved);
      setNotice(
        changed
          ? `Saved as version ${saved.currentVersion}.`
          : 'No changes to save.',
      );
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError)
        setProblems(err.detail<FieldProblem[]>('errors') ?? []);
    } finally {
      setSaving(false);
    }
  }

  const title = question
    ? 'Edit question'
    : `New ${type === 'mcq' ? 'MCQ' : 'coding'} question`;

  return (
    <div className={q.editorLayout}>
      <form className={q.form} onSubmit={save} noValidate>
        <header>
          <h1 className={styles.title}>{title}</h1>
          {question && (
            <div className={styles.badges}>
              <StatusBadge status={question.status} />
              <DifficultyBadge difficulty={question.difficulty} />
              <span className={styles.badge}>v{question.currentVersion}</span>
              {question.externalId && (
                <span className={styles.badge}>ext: {question.externalId}</span>
              )}
            </div>
          )}
        </header>

        {question?.status === 'rejected' && question.reviewNote && (
          <div className={styles.alertBox}>
            <strong>
              Changes requested
              {question.reviewedBy && ` by ${question.reviewedBy.name}`}
            </strong>
            <p>{question.reviewNote}</p>
          </div>
        )}

        <section className={styles.card}>
          <h2>Question</h2>
          <Field label="Title" htmlFor="q-title">
            <input
              id="q-title"
              className={styles.input}
              value={form.title}
              maxLength={200}
              onChange={(e) => set('title', e.target.value)}
              required
            />
          </Field>
          <Field
            label="Question text"
            htmlFor="q-body"
            hint="Markdown supported (**bold**, `code`, lists)."
          >
            <textarea
              id="q-body"
              className={q.textarea}
              value={form.body}
              maxLength={20000}
              onChange={(e) => set('body', e.target.value)}
              required
            />
          </Field>
          <div className={q.grid3}>
            <Field label="Topic" htmlFor="q-topic">
              <select
                id="q-topic"
                className={styles.select}
                value={form.topicId}
                onChange={(e) => set('topicId', e.target.value)}
                required
              >
                <option value="">Choose a topic…</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className={q.field}>
              <span className={q.fieldLabel} id="q-difficulty">
                Difficulty
              </span>
              <div
                className={q.segmented}
                role="group"
                aria-labelledby="q-difficulty"
              >
                {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={form.difficulty === d}
                    onClick={() => set('difficulty', d)}
                  >
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Marks" htmlFor="q-marks">
              <input
                id="q-marks"
                className={styles.input}
                type="number"
                min={1}
                max={100}
                value={form.marks}
                onChange={(e) => set('marks', e.target.value)}
              />
            </Field>
          </div>
          <TagPicker
            tags={tags}
            selected={form.tagIds}
            onChange={(ids) => set('tagIds', ids)}
          />
        </section>

        {form.type === 'mcq' ? (
          <McqEditor value={form.mcq} onChange={(mcq) => set('mcq', mcq)} />
        ) : (
          <CodingEditor
            value={form.coding}
            onChange={(coding) => set('coding', coding)}
          />
        )}

        <section className={styles.card}>
          <h2>Explanation</h2>
          <Field label="Shown after answering (optional)" htmlFor="q-expl">
            <textarea
              id="q-expl"
              className={q.textarea}
              style={{ minHeight: 90 }}
              value={form.explanation}
              maxLength={10000}
              onChange={(e) => set('explanation', e.target.value)}
            />
          </Field>
        </section>

        {problems.length > 1 && (
          <ul className={q.problems} role="alert">
            {problems.map((p, i) => (
              <li key={i}>
                <strong>{p.field}</strong>: {p.message}
              </li>
            ))}
          </ul>
        )}
        <FormAlert>{problems.length <= 1 ? error : ''}</FormAlert>
        <FormAlert kind="success">{notice}</FormAlert>

        <div className={q.saveBar}>
          {question && (
            <input
              className={styles.input}
              placeholder="What changed? (optional, shown in version history)"
              aria-label="Change note"
              maxLength={500}
              value={form.changeNote}
              onChange={(e) => set('changeNote', e.target.value)}
            />
          )}
          <button
            className={btn.primary}
            disabled={saving || (question !== null && !dirty)}
          >
            {saving
              ? 'Saving…'
              : question
                ? 'Save new version'
                : 'Create draft'}
          </button>
          {dirty && question && (
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setForm(initial)}
              disabled={saving}
            >
              Discard changes
            </button>
          )}
        </div>
      </form>

      {question && (
        <SidePanel question={question} dirty={dirty} onChange={onSaved} />
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={q.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small className={q.hint}>{hint}</small>}
    </div>
  );
}

function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  const group = (kind: Tag['kind']) => tags.filter((t) => t.kind === kind);
  return (
    <div className={q.field}>
      <span className={q.fieldLabel}>Tags</span>
      {tags.length === 0 && (
        <small className={q.hint}>
          No tags yet — add some under{' '}
          <Link to="/admin/taxonomy">Taxonomy</Link>.
        </small>
      )}
      {(['skill', 'company'] as const).map(
        (kind) =>
          group(kind).length > 0 && (
            <div
              key={kind}
              className={q.chips}
              role="group"
              aria-label={kind === 'skill' ? 'Skill tags' : 'Company tags'}
            >
              <small
                className={q.hint}
                style={{ width: 70, alignSelf: 'center' }}
              >
                {kind === 'skill' ? 'Skills' : 'Companies'}
              </small>
              {group(kind).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={q.chip}
                  aria-pressed={selected.includes(t.id)}
                  onClick={() => toggle(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ),
      )}
    </div>
  );
}

function McqEditor({
  value,
  onChange,
}: {
  value: QuestionFormState['mcq'];
  onChange: (v: QuestionFormState['mcq']) => void;
}) {
  const update = (
    i: number,
    patch: Partial<QuestionFormState['mcq']['options'][number]>,
  ) =>
    onChange({
      ...value,
      options: value.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    });
  const markCorrect = (i: number, checked: boolean) =>
    value.allowMultiple
      ? update(i, { isCorrect: checked })
      : onChange({
          ...value,
          options: value.options.map((o, j) => ({ ...o, isCorrect: j === i })),
        });

  return (
    <section className={styles.card}>
      <h2>Answer options</h2>
      <label className={q.correctToggle}>
        <input
          type="checkbox"
          checked={value.allowMultiple}
          onChange={(e) =>
            onChange({
              allowMultiple: e.target.checked,
              // Switching to single-answer keeps only the first correct option.
              options: e.target.checked
                ? value.options
                : value.options.map((o, i) => ({
                    ...o,
                    isCorrect:
                      i ===
                      Math.max(
                        0,
                        value.options.findIndex((x) => x.isCorrect),
                      ),
                  })),
            })
          }
        />
        Multiple correct answers
      </label>
      <div className={q.options}>
        {value.options.map((o, i) => (
          <div key={i} className={q.optionRow}>
            <label className={q.correctToggle}>
              <input
                type={value.allowMultiple ? 'checkbox' : 'radio'}
                name="correct-option"
                checked={o.isCorrect}
                onChange={(e) => markCorrect(i, e.target.checked)}
              />
              Correct
            </label>
            <input
              type="text"
              className={styles.input}
              aria-label={`Option ${i + 1}`}
              placeholder={`Option ${String.fromCharCode(65 + i)}`}
              value={o.text}
              maxLength={1000}
              onChange={(e) => update(i, { text: e.target.value })}
            />
            <button
              type="button"
              className={q.iconBtn}
              aria-label={`Remove option ${i + 1}`}
              disabled={value.options.length <= 2}
              onClick={() =>
                onChange({
                  ...value,
                  options: value.options.filter((_, j) => j !== i),
                })
              }
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className={btn.secondary}
          disabled={value.options.length >= 8}
          onClick={() =>
            onChange({
              ...value,
              options: [...value.options, { text: '', isCorrect: false }],
            })
          }
        >
          + Add option
        </button>
      </div>
    </section>
  );
}

function CodingEditor({
  value,
  onChange,
}: {
  value: QuestionFormState['coding'];
  onChange: (v: QuestionFormState['coding']) => void;
}) {
  const [lang, setLang] = useState<(typeof LANGUAGES)[number]>('python');
  const setCase = (
    i: number,
    patch: Partial<QuestionFormState['coding']['testCases'][number]>,
  ) =>
    onChange({
      ...value,
      testCases: value.testCases.map((t, j) =>
        j === i ? { ...t, ...patch } : t,
      ),
    });

  return (
    <>
      <section className={styles.card}>
        <h2>Limits & starter code</h2>
        <div className={q.twoCol}>
          <Field label="Time limit (ms)" htmlFor="c-time">
            <input
              id="c-time"
              className={styles.input}
              type="number"
              min={100}
              max={10000}
              value={value.timeLimitMs}
              onChange={(e) =>
                onChange({ ...value, timeLimitMs: e.target.value })
              }
            />
          </Field>
          <Field label="Memory limit (MB)" htmlFor="c-mem">
            <input
              id="c-mem"
              className={styles.input}
              type="number"
              min={16}
              max={1024}
              value={value.memoryLimitMb}
              onChange={(e) =>
                onChange({ ...value, memoryLimitMb: e.target.value })
              }
            />
          </Field>
        </div>
        <div className={q.field}>
          <span className={q.fieldLabel}>Starter code</span>
          <div className={q.segmented} role="group" aria-label="Language">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
              >
                {LANGUAGE_LABELS[l]}
                {value.starterCode[l]?.trim() ? ' •' : ''}
              </button>
            ))}
          </div>
          <textarea
            className={`${q.textarea} ${q.code}`}
            aria-label={`${LANGUAGE_LABELS[lang]} starter code`}
            spellCheck={false}
            value={value.starterCode[lang] ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                starterCode: { ...value.starterCode, [lang]: e.target.value },
              })
            }
            placeholder={`Optional ${LANGUAGE_LABELS[lang]} template shown to candidates`}
          />
        </div>
      </section>

      <section className={styles.card}>
        <h2>Test cases</h2>
        <p className={q.hint} style={{ margin: 0 }}>
          Samples are shown to candidates; hidden cases are only used for
          grading. Program reads stdin and writes stdout.
        </p>
        {value.testCases.map((t, i) => (
          <div key={i} className={q.testCase}>
            <div className={q.testCaseHead}>
              <strong>Case {i + 1}</strong>
              <label className={q.correctToggle}>
                <input
                  type="checkbox"
                  checked={t.isSample}
                  onChange={(e) => setCase(i, { isSample: e.target.checked })}
                />
                Sample (visible)
              </label>
              <label className={q.correctToggle}>
                Weight
                <input
                  className={q.inlineInput}
                  type="number"
                  min={1}
                  max={100}
                  value={t.weight}
                  onChange={(e) => setCase(i, { weight: e.target.value })}
                />
              </label>
              <button
                type="button"
                className={q.iconBtn}
                aria-label={`Remove case ${i + 1}`}
                disabled={value.testCases.length <= 1}
                onClick={() =>
                  onChange({
                    ...value,
                    testCases: value.testCases.filter((_, j) => j !== i),
                  })
                }
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className={q.twoCol}>
              <textarea
                className={`${q.textarea} ${q.code}`}
                aria-label={`Case ${i + 1} input`}
                placeholder="Input (stdin)"
                spellCheck={false}
                value={t.input}
                onChange={(e) => setCase(i, { input: e.target.value })}
              />
              <textarea
                className={`${q.textarea} ${q.code}`}
                aria-label={`Case ${i + 1} expected output`}
                placeholder="Expected output (stdout)"
                spellCheck={false}
                value={t.expectedOutput}
                onChange={(e) => setCase(i, { expectedOutput: e.target.value })}
              />
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={btn.secondary}
            disabled={value.testCases.length >= 100}
            onClick={() =>
              onChange({
                ...value,
                testCases: [
                  ...value.testCases,
                  {
                    input: '',
                    expectedOutput: '',
                    isSample: false,
                    weight: '1',
                  },
                ],
              })
            }
          >
            + Add test case
          </button>
        </div>
      </section>
    </>
  );
}

const ACTION_LABELS: Record<WorkflowAction, string> = {
  submit: 'Submit for review',
  withdraw: 'Withdraw from review',
  approve: 'Approve & publish',
  reject: 'Request changes',
  archive: 'Archive',
  restore: 'Restore',
};

function SidePanel({
  question,
  dirty,
  onChange,
}: {
  question: QuestionDetail;
  dirty: boolean;
  onChange: (q: QuestionDetail) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<QuestionVersion | null>(null);

  const s = question.status;
  const actions: WorkflowAction[] = [
    ...(s === 'draft' || s === 'rejected' ? (['submit'] as const) : []),
    ...(s === 'pending_review' ? (['withdraw'] as const) : []),
    ...(isAdmin && s === 'pending_review'
      ? (['approve', 'reject'] as const)
      : []),
    ...(isAdmin && s !== 'archived' ? (['archive'] as const) : []),
    ...(isAdmin && s === 'archived' ? (['restore'] as const) : []),
  ];

  async function run(action: WorkflowAction) {
    setBusy(true);
    setError('');
    try {
      onChange(await questionsApi.transition(question.id, action, note.trim()));
      setPending(null);
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsDialog = (a: WorkflowAction) =>
    a === 'reject' || a === 'archive' || a === 'approve';

  return (
    <aside className={`${q.sticky} ${styles.stack}`}>
      <section className={styles.card} aria-labelledby="wf-heading">
        <h2 id="wf-heading">Review</h2>
        <dl className={styles.facts} style={{ gridTemplateColumns: '1fr' }}>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={s} />
            </dd>
          </div>
          <div>
            <dt>Live for candidates</dt>
            <dd>
              {question.liveVersion
                ? `Version ${question.liveVersion}`
                : 'Not published'}
            </dd>
          </div>
          {question.submittedBy && s === 'pending_review' && (
            <div>
              <dt>Submitted</dt>
              <dd>
                {question.submittedBy.name} ·{' '}
                {formatDate(question.submittedAt, true)}
              </dd>
            </div>
          )}
        </dl>
        {dirty && actions.length > 0 && (
          <p className={q.hint} style={{ margin: 0 }}>
            Save your changes before changing status.
          </p>
        )}
        <div className={styles.actions}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={
                a === 'approve' || a === 'submit'
                  ? btn.primary
                  : a === 'reject' || a === 'archive'
                    ? btn.danger
                    : btn.secondary
              }
              disabled={busy || dirty}
              onClick={() => (needsDialog(a) ? setPending(a) : void run(a))}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
          {actions.length === 0 && (
            <p className={styles.muted} style={{ margin: 0 }}>
              Waiting for an admin to review.
            </p>
          )}
        </div>
        <FormAlert>{!pending ? error : ''}</FormAlert>
      </section>

      <section className={styles.card} aria-labelledby="hist-heading">
        <h2 id="hist-heading">Version history</h2>
        <ul className={q.historyList}>
          {question.history.map((h) => (
            <li key={h.versionNumber}>
              <button
                type="button"
                className={q.historyItem}
                onClick={() =>
                  void questionsApi
                    .version(question.id, h.versionNumber)
                    .then(setViewing, (e: unknown) => setError(errorMessage(e)))
                }
              >
                <strong>
                  v{h.versionNumber}
                  {h.isCurrent && ' · current'}
                  {h.isLive && ' · live'}
                </strong>
                <span>{h.changeNote ?? 'No note'}</span>
                <span>
                  {h.createdBy?.name ?? 'System'} ·{' '}
                  {formatDate(h.createdAt, true)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={pending !== null}
        title={
          pending === 'reject'
            ? 'Request changes'
            : pending === 'archive'
              ? 'Archive this question?'
              : 'Approve and publish?'
        }
        onClose={() => !busy && setPending(null)}
        actions={
          <>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={pending === 'approve' ? btn.primary : btn.danger}
              disabled={
                busy || (pending === 'reject' && note.trim().length < 3)
              }
              onClick={() => pending && void run(pending)}
            >
              {busy ? 'Working…' : pending ? ACTION_LABELS[pending] : ''}
            </button>
          </>
        }
      >
        {pending === 'reject' && (
          <div className={q.field}>
            <label htmlFor="reject-note">What should the author fix?</label>
            <textarea
              id="reject-note"
              className={q.textarea}
              style={{ minHeight: 90 }}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        {pending === 'approve' && (
          <p>
            Version {question.currentVersion} becomes the live version
            candidates see.
          </p>
        )}
        {pending === 'archive' && (
          <p>It will be hidden from candidates. You can restore it later.</p>
        )}
        <FormAlert>{error}</FormAlert>
      </Dialog>

      <Dialog
        open={viewing !== null}
        title={
          viewing ? `Version ${viewing.versionNumber}: ${viewing.title}` : ''
        }
        onClose={() => setViewing(null)}
        actions={
          <button
            type="button"
            className={btn.secondary}
            onClick={() => setViewing(null)}
          >
            Close
          </button>
        }
      >
        {viewing && <VersionView v={viewing} />}
      </Dialog>
    </aside>
  );
}

function VersionView({ v }: { v: QuestionVersion }) {
  return (
    <>
      <p>
        {DIFFICULTY_LABELS[v.difficulty]} · {v.marks} mark
        {v.marks === 1 ? '' : 's'} · {v.createdBy?.name ?? 'System'},{' '}
        {formatDate(v.createdAt, true)}
      </p>
      <pre className={q.pre}>{v.body}</pre>
      {'mcq' in v.content ? (
        <ul>
          {v.content.mcq.options.map((o) => (
            <li key={o.id}>
              {o.isCorrect ? '✓ ' : ''}
              {o.text}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {v.content.coding.testCases.length} test cases (
          {v.content.coding.testCases.filter((t) => t.isSample).length} sample)
          · {v.content.coding.timeLimitMs} ms · {v.content.coding.memoryLimitMb}{' '}
          MB
        </p>
      )}
    </>
  );
}
