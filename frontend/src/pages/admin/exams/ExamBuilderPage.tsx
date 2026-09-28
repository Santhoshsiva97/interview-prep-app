import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormField';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { Dialog } from '../../../components/ui/Dialog';
import { Markdown } from '../../../components/ui/Markdown';
import { formatDate } from '../../../features/admin/api';
import { useAuth } from '../../../features/auth/useAuth';
import {
  adminExamsApi,
  EXAM_STATUS_LABELS,
  formatMinutes,
  KIND_LABELS,
  type ExamAction,
  type ExamDetail,
  type ExamKind,
} from '../../../features/exams/api';
import { QuestionPicker } from '../../../features/exams/components/QuestionPicker';
import {
  blankExam,
  blankSection,
  formFromExam,
  formKey,
  formToInput,
  problemTarget,
  sectionTotal,
  type ExamForm,
  type SectionForm,
} from '../../../features/exams/examForm';
import { DifficultyBadge } from '../../../features/questions/components/QuestionBadges';
import { REVIEW_POLICY_LABELS } from '../../../features/scorecards/api';
import { ApiError, errorMessage } from '../../../lib/api';
import styles from '../Admin.module.css';
import q from '../questions/Questions.module.css';
import x from './Exams.module.css';

type Problem = { field: string; message: string };

/** Create (/admin/exams/new) or edit (/admin/exams/:id) an exam (FRD §4.6). */
export function ExamBuilderPage() {
  const { id } = useParams();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    adminExamsApi
      .get(id)
      .then((e) => !cancelled && setExam(e))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Link to="/admin/exams" className={styles.backLink}>
      <Icon name="arrowLeft" size={16} /> Exams
    </Link>
  );
  if (error)
    return (
      <div className={styles.page}>
        {back}
        <p role="alert">{error}</p>
      </div>
    );
  if (id && !exam) return <p aria-busy="true">Loading…</p>;
  return (
    <div className={styles.page}>
      {back}
      <Builder key={exam?.id ?? 'new'} exam={exam} onSaved={setExam} />
    </div>
  );
}

function Builder({
  exam,
  onSaved,
}: {
  exam: ExamDetail | null;
  onSaved: (e: ExamDetail) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [initial, setInitial] = useState(() =>
    exam ? formFromExam(exam) : blankExam(),
  );
  const [form, setForm] = useState<ExamForm>(initial);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const dirty = formKey(form) !== formKey(initial);
  // Published exams are admin-only to change (the API enforces it too).
  const readOnly =
    exam?.status === 'archived' || (exam?.status === 'published' && !isAdmin);

  const set = <K extends keyof ExamForm>(k: K, v: ExamForm[K]) => {
    setNotice('');
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setSection = (i: number, patch: Partial<SectionForm>) =>
    set(
      'sections',
      form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const moveSection = (i: number, d: number) => {
    const next = [...form.sections];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set('sections', next);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setProblems([]);
    try {
      const input = formToInput(form);
      if (!exam) {
        const created = await adminExamsApi.create(input);
        navigate(`/admin/exams/${created.id}`, { replace: true });
        return;
      }
      const saved = await adminExamsApi.update(exam.id, input);
      const next = formFromExam(saved);
      setInitial(next);
      setForm(next);
      onSaved(saved);
      setNotice('Saved.');
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError)
        setProblems(err.detail<Problem[]>('errors') ?? []);
    } finally {
      setSaving(false);
    }
  }

  const inExam = new Set(
    form.sections.flatMap((s) => s.questions.map((qq) => qq.questionId)),
  );
  const generalProblems = problems.filter(
    (p) => problemTarget(p.field).section === undefined,
  );

  return (
    <div className={q.editorLayout}>
      <form className={q.form} onSubmit={save} noValidate>
        <header>
          <h1 className={styles.title}>{exam ? exam.title : 'New exam'}</h1>
          {exam && (
            <div className={styles.badges}>
              <span
                className={styles.badge}
                data-tone={exam.status === 'published' ? 'success' : undefined}
              >
                {EXAM_STATUS_LABELS[exam.status]}
              </span>
              <span className={styles.badge}>{KIND_LABELS[exam.kind]}</span>
            </div>
          )}
        </header>
        {readOnly && (
          <div className={styles.alertBox}>
            {exam?.status === 'archived'
              ? 'This exam is archived. Restore it to make changes.'
              : 'This exam is live. Only admins can change it.'}
          </div>
        )}

        <fieldset className={x.fieldset} disabled={readOnly}>
          <section className={styles.card}>
            <h2>Details</h2>
            <Field label="Title" htmlFor="e-title">
              <input
                id="e-title"
                className={styles.input}
                value={form.title}
                maxLength={200}
                onChange={(e) => set('title', e.target.value)}
                required
              />
            </Field>
            <div className={q.field}>
              <span className={q.fieldLabel} id="e-kind">
                Type
              </span>
              <div
                className={q.segmented}
                role="group"
                aria-labelledby="e-kind"
              >
                {(Object.keys(KIND_LABELS) as ExamKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={form.kind === k}
                    onClick={() => set('kind', k)}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            <Field
              label="Summary (optional)"
              htmlFor="e-desc"
              hint="One or two sentences for the test catalog."
            >
              <input
                id="e-desc"
                className={styles.input}
                value={form.description}
                maxLength={1000}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            <div className={q.field}>
              <div className={x.labelRow}>
                <label htmlFor="e-instr">Instructions for candidates</label>
                <button
                  type="button"
                  className={x.linkBtn}
                  onClick={() => setPreview((p) => !p)}
                >
                  {preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {preview ? (
                <div className={x.preview}>
                  <Markdown>{form.instructions}</Markdown>
                </div>
              ) : (
                <textarea
                  id="e-instr"
                  className={q.textarea}
                  value={form.instructions}
                  maxLength={20000}
                  onChange={(e) => set('instructions', e.target.value)}
                />
              )}
              <small className={q.hint}>
                Shown on the start screen, where candidates must accept them.
                Markdown supported.
              </small>
            </div>
          </section>

          <section className={styles.card}>
            <h2>Timing & rules</h2>
            <div className={q.grid3}>
              <Field
                label="Total time (minutes)"
                htmlFor="e-duration"
                hint={
                  form.sectionTimed
                    ? 'Sum of the section time limits.'
                    : undefined
                }
              >
                <input
                  id="e-duration"
                  className={styles.input}
                  type="number"
                  min={1}
                  max={600}
                  value={
                    form.sectionTimed
                      ? sectionTotal(form)
                      : form.durationMinutes
                  }
                  disabled={form.sectionTimed}
                  onChange={(e) => set('durationMinutes', e.target.value)}
                />
              </Field>
              <Field
                label="Attempts allowed"
                htmlFor="e-attempts"
                hint="Blank = unlimited."
              >
                <input
                  id="e-attempts"
                  className={styles.input}
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxAttempts}
                  onChange={(e) => set('maxAttempts', e.target.value)}
                />
              </Field>
              <Field label="Pass mark (%)" htmlFor="e-pass" hint="Optional.">
                <input
                  id="e-pass"
                  className={styles.input}
                  type="number"
                  min={0}
                  max={100}
                  value={form.passPercent}
                  onChange={(e) => set('passPercent', e.target.value)}
                />
              </Field>
            </div>
            <Field
              label="After grading, candidates see"
              htmlFor="e-review"
              hint="Applies to attempts started after you save."
            >
              <select
                id="e-review"
                className={styles.select}
                value={form.answerReview}
                onChange={(e) =>
                  set(
                    'answerReview',
                    e.target.value as ExamForm['answerReview'],
                  )
                }
              >
                {(
                  Object.entries(REVIEW_POLICY_LABELS) as [
                    ExamForm['answerReview'],
                    string,
                  ][]
                ).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <div className={x.toggles}>
              <Toggle
                checked={form.sectionTimed}
                onChange={(v) => set('sectionTimed', v)}
                label="Time each section separately"
                hint="Sections run in order with their own timers; a finished section locks."
              />
              <Toggle
                checked={form.pauseOnDisconnect}
                onChange={(v) => set('pauseOnDisconnect', v)}
                label="Pause the timer while a candidate is disconnected"
                hint="Off = the clock keeps running (stricter, for proctored tests)."
              />
              <Toggle
                checked={form.shuffleQuestions}
                onChange={(v) => set('shuffleQuestions', v)}
                label="Shuffle question order within each section"
              />
              <Toggle
                checked={form.shuffleOptions}
                onChange={(v) => set('shuffleOptions', v)}
                label="Shuffle MCQ options"
              />
            </div>
          </section>

          {form.sections.map((s, i) => (
            <SectionCard
              key={s.key}
              index={i}
              count={form.sections.length}
              section={s}
              timed={form.sectionTimed}
              problems={problems.filter(
                (p) => problemTarget(p.field).section === i,
              )}
              onChange={(patch) => setSection(i, patch)}
              onMove={(d) => moveSection(i, d)}
              onRemove={() =>
                set(
                  'sections',
                  form.sections.filter((_, j) => j !== i),
                )
              }
              onPick={() => setPicking(i)}
            />
          ))}
          <button
            type="button"
            className={`${btn.secondary} ${x.addSection}`}
            onClick={() =>
              set('sections', [
                ...form.sections,
                blankSection(form.sections.length + 1),
              ])
            }
          >
            + Add section
          </button>
        </fieldset>

        {generalProblems.length > 0 && (
          <ul className={q.problems} role="alert">
            {generalProblems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        )}
        <FormAlert>{error}</FormAlert>
        <FormAlert kind="success">{notice}</FormAlert>

        {!readOnly && (
          <div className={q.saveBar}>
            <button
              className={btn.primary}
              disabled={saving || (!!exam && !dirty)}
            >
              {saving ? 'Saving…' : exam ? 'Save changes' : 'Create draft'}
            </button>
            {dirty && exam && (
              <button
                type="button"
                className={btn.secondary}
                onClick={() => setForm(initial)}
                disabled={saving}
              >
                Discard changes
              </button>
            )}
            {exam?.status === 'published' && (
              <small className={q.hint}>
                Changes apply to new attempts; attempts in progress keep their
                copy.
              </small>
            )}
          </div>
        )}
      </form>

      {exam && <SidePanel exam={exam} dirty={dirty} onChange={onSaved} />}

      <QuestionPicker
        open={picking !== null}
        sectionTitle={picking !== null ? form.sections[picking]?.title : ''}
        alreadyInExam={inExam}
        onClose={() => setPicking(null)}
        onAdd={(picked) => {
          if (picking === null) return;
          const s = form.sections[picking];
          setSection(picking, { questions: [...s.questions, ...picked] });
        }}
      />
    </div>
  );
}

function SectionCard({
  index,
  count,
  section: s,
  timed,
  problems,
  onChange,
  onMove,
  onRemove,
  onPick,
}: {
  index: number;
  count: number;
  section: SectionForm;
  timed: boolean;
  problems: Problem[];
  onChange: (patch: Partial<SectionForm>) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  const questionProblem = (i: number) =>
    problems.find((p) => problemTarget(p.field).question === i)?.message;
  const sectionProblems = problems.filter(
    (p) => problemTarget(p.field).question === undefined,
  );
  const moveQuestion = (i: number, d: number) => {
    const next = [...s.questions];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange({ questions: next });
  };
  const override = Number(s.marksPerQuestion) || null;

  return (
    <section className={styles.card} aria-label={`Section ${index + 1}`}>
      <div className={x.sectionHead}>
        <h2>Section {index + 1}</h2>
        <div className={x.sectionTools}>
          <IconButton
            label="Move section up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <Icon name="chevronDown" size={16} className={x.flip} />
          </IconButton>
          <IconButton
            label="Move section down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <Icon name="chevronDown" size={16} />
          </IconButton>
          <IconButton label="Remove section" onClick={onRemove}>
            <Icon name="close" size={16} />
          </IconButton>
        </div>
      </div>
      <div className={q.grid3}>
        <Field label="Section title" htmlFor={`s-${s.key}-title`}>
          <input
            id={`s-${s.key}-title`}
            className={styles.input}
            value={s.title}
            maxLength={120}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Field>
        {timed && (
          <Field label="Time limit (minutes)" htmlFor={`s-${s.key}-time`}>
            <input
              id={`s-${s.key}-time`}
              className={styles.input}
              type="number"
              min={1}
              max={600}
              value={s.durationMinutes}
              onChange={(e) => onChange({ durationMinutes: e.target.value })}
            />
          </Field>
        )}
        <Field
          label="Marks per question"
          htmlFor={`s-${s.key}-marks`}
          hint="Blank = each question’s own marks."
        >
          <input
            id={`s-${s.key}-marks`}
            className={styles.input}
            type="number"
            min={1}
            max={100}
            value={s.marksPerQuestion}
            onChange={(e) => onChange({ marksPerQuestion: e.target.value })}
          />
        </Field>
        <Field
          label="Negative marking (%)"
          htmlFor={`s-${s.key}-neg`}
          hint="Share of a question’s marks lost for a wrong MCQ answer."
        >
          <input
            id={`s-${s.key}-neg`}
            className={styles.input}
            type="number"
            min={0}
            max={100}
            value={s.negativeMarkPercent}
            onChange={(e) => onChange({ negativeMarkPercent: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Description (optional)" htmlFor={`s-${s.key}-desc`}>
        <input
          id={`s-${s.key}-desc`}
          className={styles.input}
          value={s.description}
          maxLength={1000}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <Toggle
        checked={s.partialScoring}
        onChange={(v) => onChange({ partialScoring: v })}
        label="Partial credit"
        hint="Coding: marks in proportion to passed test cases. Off = all or nothing."
      />

      <div className={x.questionsHead}>
        <strong>Questions ({s.questions.length})</strong>
        <button type="button" className={btn.secondary} onClick={onPick}>
          + Add questions
        </button>
      </div>
      {s.questions.length === 0 ? (
        <p className={x.emptyQuestions}>No questions yet.</p>
      ) : (
        <ol className={x.questionList}>
          {s.questions.map((qq, i) => {
            const problem = questionProblem(i);
            const stale =
              qq.pinnedVersion !== null &&
              qq.liveVersion !== null &&
              qq.pinnedVersion !== qq.liveVersion;
            const marks = override ?? qq.marks;
            return (
              <li
                key={qq.questionId}
                className={x.questionRow}
                data-problem={!!problem}
              >
                <span className={x.qIndex}>{i + 1}</span>
                <div className={x.qText}>
                  <Link
                    to={`/admin/questions/${qq.questionId}`}
                    target="_blank"
                  >
                    {qq.title}
                  </Link>
                  <small>
                    {qq.type === 'mcq' ? 'MCQ' : 'Coding'} · {qq.topicName}
                    {marks !== null &&
                      ` · ${marks} mark${marks === 1 ? '' : 's'}`}
                    {qq.pinnedVersion !== null && ` · v${qq.pinnedVersion}`}
                  </small>
                  {stale && (
                    <small className={x.warn}>
                      v{qq.liveVersion} is now live — save to use it.
                    </small>
                  )}
                  {qq.liveVersion === null && !problem && (
                    <small className={x.warn}>No published version yet.</small>
                  )}
                  {problem && <small className={x.error}>{problem}</small>}
                </div>
                <DifficultyBadge difficulty={qq.difficulty} />
                <div className={x.sectionTools}>
                  <IconButton
                    label="Move question up"
                    disabled={i === 0}
                    onClick={() => moveQuestion(i, -1)}
                  >
                    <Icon name="chevronDown" size={16} className={x.flip} />
                  </IconButton>
                  <IconButton
                    label="Move question down"
                    disabled={i === s.questions.length - 1}
                    onClick={() => moveQuestion(i, 1)}
                  >
                    <Icon name="chevronDown" size={16} />
                  </IconButton>
                  <IconButton
                    label="Remove question"
                    onClick={() =>
                      onChange({
                        questions: s.questions.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Icon name="close" size={16} />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {sectionProblems.map((p, i) => (
        <p key={i} className={x.error} role="alert">
          {p.message}
        </p>
      ))}
    </section>
  );
}

const ACTIONS: Record<ExamAction, { label: string; confirm: string }> = {
  publish: {
    label: 'Publish',
    confirm:
      'Candidates will see this exam in their catalog and can start it right away.',
  },
  unpublish: {
    label: 'Unpublish',
    confirm:
      'The exam disappears from the catalog. Attempts already in progress can still be finished.',
  },
  archive: {
    label: 'Archive',
    confirm:
      'The exam is hidden from candidates and can’t be edited until restored.',
  },
  restore: {
    label: 'Restore to draft',
    confirm: 'The exam becomes an editable draft.',
  },
};

function SidePanel({
  exam,
  dirty,
  onChange,
}: {
  exam: ExamDetail;
  dirty: boolean;
  onChange: (e: ExamDetail) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [pending, setPending] = useState<ExamAction | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const available: ExamAction[] = !isAdmin
    ? []
    : exam.status === 'draft'
      ? ['publish', 'archive']
      : exam.status === 'published'
        ? ['unpublish', 'archive']
        : ['restore'];

  async function act() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      if (pending === 'delete') {
        await adminExamsApi.remove(exam.id);
        navigate('/admin/exams', { replace: true });
        return;
      }
      onChange(await adminExamsApi.transition(exam.id, pending));
      setPending(null);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`${styles.card} ${q.sticky}`} aria-label="Exam status">
      <h2>Overview</h2>
      <dl className={x.facts}>
        <div>
          <dt>Questions</dt>
          <dd>{exam.questionCount}</dd>
        </div>
        <div>
          <dt>Total marks</dt>
          <dd>{exam.totalMarks}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatMinutes(exam.durationMinutes)}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd>{exam.sections.length}</dd>
        </div>
      </dl>
      <p className={styles.muted} style={{ margin: 0, fontSize: '0.875rem' }}>
        Updated {formatDate(exam.updatedAt)}
        {exam.updatedBy && ` by ${exam.updatedBy.name}`}
        {exam.publishedAt && (
          <>
            <br />
            Published {formatDate(exam.publishedAt)}
            {exam.publishedBy && ` by ${exam.publishedBy.name}`}
          </>
        )}
      </p>

      {exam.status === 'draft' &&
        (exam.publishProblems.length ? (
          <div>
            <strong className={x.checklistTitle}>Before publishing</strong>
            <ul className={x.checklist}>
              {exam.publishProblems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={x.ready}>
            <Icon name="check" size={16} /> Ready to publish
          </p>
        ))}
      {!isAdmin && exam.status === 'draft' && (
        <p className={styles.muted} style={{ margin: 0 }}>
          An admin publishes this exam when it’s ready.
        </p>
      )}

      {error && <FormAlert>{error}</FormAlert>}
      <div className={x.actions}>
        {available.map((a) => (
          <button
            key={a}
            type="button"
            className={a === 'publish' ? btn.primary : btn.secondary}
            disabled={
              busy ||
              dirty ||
              (a === 'publish' && exam.publishProblems.length > 0)
            }
            onClick={() => setPending(a)}
          >
            {ACTIONS[a].label}
          </button>
        ))}
        {exam.status === 'draft' && (
          <button
            type="button"
            className={btn.ghost}
            disabled={busy}
            onClick={() => setPending('delete')}
          >
            Delete draft
          </button>
        )}
      </div>
      {dirty && available.length > 0 && (
        <small className={q.hint}>Save your changes first.</small>
      )}

      <Dialog
        open={pending !== null}
        title={
          pending === 'delete'
            ? 'Delete this draft?'
            : pending
              ? `${ACTIONS[pending].label} “${exam.title}”?`
              : ''
        }
        onClose={() => setPending(null)}
        actions={
          <>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={pending === 'delete' ? btn.danger : btn.primary}
              disabled={busy}
              onClick={() => void act()}
            >
              {pending === 'delete'
                ? 'Delete'
                : pending
                  ? ACTIONS[pending].label
                  : ''}
            </button>
          </>
        }
      >
        <p>
          {pending === 'delete'
            ? 'This can’t be undone. Drafts that candidates have attempted can only be archived.'
            : pending
              ? ACTIONS[pending].confirm
              : ''}
        </p>
      </Dialog>
    </aside>
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

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className={x.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={q.iconBtn}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
