import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import { Dialog } from '../../components/ui/Dialog';
import { Markdown } from '../../components/ui/Markdown';
import {
  formatClock,
  type SessionItem,
  type SessionView,
} from '../../features/exams/api';
import {
  useExamRuntime,
  type SaveState,
} from '../../features/exams/useExamRuntime';
import { CodingPanel } from './CodingPanel';
import styles from './ExamRuntime.module.css';
import { McqPanel } from './McqPanel';
import { paletteState } from './paletteState';
import { QuestionPalette } from './QuestionPalette';
import { SubmittedSummary } from './SubmittedSummary';

/** Distraction-free exam runtime (FRD §4.6): /exam/:sessionId. */
export function ExamRuntimePage() {
  const { sessionId = '' } = useParams();
  const rt = useExamRuntime(sessionId);
  const [confirm, setConfirm] = useState<'submit' | 'section' | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const session = rt.session;

  useEffect(() => {
    if (session) document.title = `${session.exam.title} · InterviewPrep`;
  }, [session]);

  if (rt.loadError) {
    return (
      <div className={styles.centered}>
        <p role="alert">{rt.loadError}</p>
        <div className={styles.doneActions}>
          <button type="button" className={btn.primary} onClick={rt.retryLoad}>
            Try again
          </button>
          <Link to="/tests" className={btn.secondary}>
            Back to tests
          </Link>
        </div>
      </div>
    );
  }
  if (!session) return <p aria-busy="true">Loading your test…</p>;
  if (session.status === 'submitted')
    return <SubmittedSummary session={session} items={rt.items} />;

  const accessible = rt.items.filter((i) => i.question);
  const current = rt.current;
  const index = current ? accessible.indexOf(current) : -1;
  const go = (delta: number) => {
    const next = accessible[index + delta];
    if (next) rt.goTo(next.id);
  };
  const sectionTimed = session.exam.sectionTimed;
  const isLastSection =
    session.currentSectionIndex === session.sections.length - 1;
  const endsSection = sectionTimed && !isLastSection;
  const scope = sectionTimed ? accessible : rt.items;
  const counts = {
    answered: scope.filter((i) => i.answered).length,
    review: scope.filter((i) => i.markedForReview).length,
    total: scope.length,
  };
  const section = session.sections[current?.sectionIndex ?? 0];

  return (
    <div className={styles.runtime}>
      <header className={styles.topBar}>
        <div className={styles.examTitle}>
          <strong>{session.exam.title}</strong>
          {session.sections.length > 1 && section && (
            <span>
              Section {section.index + 1} of {session.sections.length}:{' '}
              {section.title}
            </span>
          )}
        </div>
        <SaveIndicator state={rt.saveState} lastSavedAt={rt.lastSavedAt} />
        <div className={styles.timers}>
          {rt.sectionRemainingMs !== null && (
            <Timer label="Section" ms={rt.sectionRemainingMs} />
          )}
          <Timer
            label={sectionTimed ? 'Total' : 'Time left'}
            ms={rt.remainingMs}
          />
        </div>
        <button
          type="button"
          className={`${btn.secondary} ${styles.paletteToggle}`}
          aria-expanded={paletteOpen}
          aria-controls="question-palette"
          onClick={() => setPaletteOpen((o) => !o)}
        >
          Questions
        </button>
        <button
          type="button"
          className={btn.primary}
          onClick={() => setConfirm(endsSection ? 'section' : 'submit')}
          disabled={rt.submitting}
        >
          {endsSection ? (
            <>
              <span className={styles.longLabel}>Finish section</span>
              <span className={styles.shortLabel}>Finish</span>
            </>
          ) : (
            'Submit'
          )}
        </button>
      </header>

      {rt.saveState === 'offline' && (
        <div className={styles.banner} role="status">
          You’re offline. Keep going — your answers are kept on this device and
          will be saved when the connection returns.{' '}
          {session.exam.pauseOnDisconnect
            ? 'Time spent offline won’t be counted against you.'
            : 'The timer keeps running.'}
        </div>
      )}
      {rt.notice && (
        <div className={styles.banner} role="status">
          {rt.notice}{' '}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={rt.dismissNotice}
          >
            Dismiss
          </button>
        </div>
      )}
      {rt.submitError && (
        <div className={styles.bannerDanger} role="alert">
          {rt.submitError}
        </div>
      )}

      <div className={styles.body}>
        <main className={styles.main}>
          {current?.question ? (
            <QuestionView
              key={current.id}
              session={session}
              item={current}
              number={index + 1}
              total={accessible.length}
              onResponse={rt.setResponse}
            />
          ) : (
            <p className={styles.muted}>Pick a question from the list.</p>
          )}
        </main>

        <aside
          id="question-palette"
          className={styles.palette}
          data-open={paletteOpen}
          aria-label="Questions"
        >
          <QuestionPalette
            session={session}
            items={rt.items}
            currentId={current?.id ?? null}
            onPick={(id) => {
              rt.goTo(id);
              setPaletteOpen(false);
            }}
          />
        </aside>
      </div>

      {current && (
        <footer className={styles.bottomBar}>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => go(-1)}
            disabled={index <= 0}
          >
            <Icon name="chevronLeft" size={16} /> Previous
          </button>
          <label className={styles.reviewToggle}>
            <input
              type="checkbox"
              checked={current.markedForReview}
              onChange={(e) => rt.setReview(current.id, e.target.checked)}
            />
            Mark for review
          </label>
          {current.answered && current.type === 'mcq' && (
            <button
              type="button"
              className={btn.ghost}
              onClick={() => rt.setResponse(current.id, null)}
            >
              Clear answer
            </button>
          )}
          <button
            type="button"
            className={btn.primary}
            onClick={() => go(1)}
            disabled={index >= accessible.length - 1}
          >
            Next <Icon name="chevronRight" size={16} />
          </button>
        </footer>
      )}

      <Dialog
        open={confirm !== null}
        title={
          confirm === 'section' ? 'Finish this section?' : 'Submit your test?'
        }
        onClose={() => setConfirm(null)}
        actions={
          <>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setConfirm(null)}
            >
              Keep working
            </button>
            <button
              type="button"
              className={btn.primary}
              disabled={rt.submitting}
              onClick={() => {
                setConfirm(null);
                void (confirm === 'section'
                  ? rt.nextSection()
                  : rt.submit(false));
              }}
            >
              {confirm === 'section' ? 'Finish section' : 'Submit'}
            </button>
          </>
        }
      >
        <ul className={styles.summaryList}>
          <li>
            <strong>{counts.answered}</strong> of {counts.total} answered
          </li>
          <li>
            <strong>{counts.total - counts.answered}</strong> not answered
          </li>
          {counts.review > 0 && (
            <li>
              <strong>{counts.review}</strong> marked for review
            </li>
          )}
        </ul>
        <p>
          {confirm === 'section'
            ? 'You won’t be able to come back to this section. Any time left on it is forfeited.'
            : 'You can’t change your answers after submitting.'}
        </p>
      </Dialog>
    </div>
  );
}

function QuestionView({
  session,
  item,
  number,
  total,
  onResponse,
}: {
  session: SessionView;
  item: SessionItem;
  number: number;
  total: number;
  onResponse: ReturnType<typeof useExamRuntime>['setResponse'];
}) {
  const q = item.question!;
  const header = (
    <div className={styles.questionHead}>
      <span className={styles.qNumber}>
        Question {number} of {total}
      </span>
      <span className={styles.qMeta}>
        {item.marks} mark{item.marks === 1 ? '' : 's'}
        {item.negativeMarkPercent > 0 &&
          ` · −${Math.round(item.marks * item.negativeMarkPercent) / 100} for a wrong answer`}
      </span>
      <span className={styles.qState} data-state={paletteState(item)}>
        {item.answered ? 'Answered' : 'Not answered'}
        {item.markedForReview && ' · for review'}
      </span>
    </div>
  );
  const statement = (
    <>
      <h1 className={styles.qTitle}>{q.title}</h1>
      <Markdown>{q.body}</Markdown>
    </>
  );

  if ('mcq' in q) {
    return (
      <article className={styles.questionCard}>
        {header}
        {statement}
        <McqPanel
          item={item}
          question={q}
          onChange={(r) => onResponse(item.id, r)}
        />
      </article>
    );
  }
  return (
    <CodingPanel
      sessionId={session.id}
      item={item}
      question={q}
      header={header}
      statement={statement}
      onChange={(r) => onResponse(item.id, r)}
    />
  );
}

function Timer({ label, ms }: { label: string; ms: number }) {
  const tone =
    ms <= 60_000 ? 'danger' : ms <= 5 * 60_000 ? 'warning' : undefined;
  return (
    <div className={styles.timer} data-tone={tone} role="timer" aria-live="off">
      <span>{label}</span>
      <strong>{formatClock(ms)}</strong>
    </div>
  );
}

function SaveIndicator({
  state,
  lastSavedAt,
}: {
  state: SaveState;
  lastSavedAt: Date | null;
}) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'offline'
        ? 'Offline — saved on this device'
        : state === 'unsaved'
          ? 'Unsaved changes'
          : lastSavedAt
            ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'All changes saved';
  return (
    <span className={styles.saveState} data-state={state} aria-live="polite">
      {text}
    </span>
  );
}
