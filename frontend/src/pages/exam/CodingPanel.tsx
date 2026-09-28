import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import btn from '../../components/ui/Button.module.css';
import {
  examsApi,
  type CodingResponse,
  type CodeRun,
  type TestVerdict,
  type RuntimeQuestion,
  type SessionItem,
} from '../../features/exams/api';
import { LANGUAGE_LABELS, type Language } from '../../features/questions/api';
import { ApiError, errorMessage } from '../../lib/api';
import styles from './ExamRuntime.module.css';

const CodeEditor = lazy(
  () => import('../../features/exams/components/CodeEditor'),
);

type CodingQuestion = Extract<RuntimeQuestion, { coding: unknown }>;

const VERDICT_LABEL: Record<TestVerdict, string> = {
  AC: 'Passed',
  WA: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RE: 'Runtime error',
  CE: 'Compilation error',
  IE: 'Judge error',
};

/** Runs are queued on the server (FRD §4.7); poll until they finish. */
const POLL_MS = 1000;
const POLL_TIMEOUT_MS = 90_000;
const done = (r: CodeRun) => r.status === 'completed' || r.status === 'failed';

/** Problem statement + Monaco editor + "Run on sample tests" (FRD §4.6). */
export function CodingPanel({
  sessionId,
  item,
  question,
  header,
  statement,
  onChange,
}: {
  sessionId: string;
  item: SessionItem;
  question: CodingQuestion;
  header: ReactNode;
  statement: ReactNode;
  onChange: (response: CodingResponse | null) => void;
}) {
  const saved =
    item.response && 'sources' in item.response ? item.response : null;
  const { coding } = question;
  const [language, setLanguage] = useState<Language>(
    () =>
      saved?.language ??
      coding.languages.find((l) => coding.starterCode[l]) ??
      coding.languages[0],
  );
  const [run, setRun] = useState<CodeRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const sources = saved?.sources ?? {};
  const code = sources[language] ?? coding.starterCode[language] ?? '';

  const edit = (next: string) =>
    onChange(
      next.trim()
        ? { language, sources: { ...sources, [language]: next } }
        : null,
    );

  const switchLanguage = (next: Language) => {
    setLanguage(next);
    setRun(null);
    // Only an answer that already exists follows the language switch.
    const nextCode = sources[next] ?? coding.starterCode[next] ?? '';
    if (saved && nextCode.trim())
      onChange({ language: next, sources: { ...sources, [next]: nextCode } });
  };

  async function runSamples() {
    setRunning(true);
    setRunError('');
    setRun(null);
    try {
      let r = await examsApi.run(sessionId, item.id, language, code);
      const until = Date.now() + POLL_TIMEOUT_MS;
      while (!done(r) && alive.current) {
        if (Date.now() > until) {
          setRunError(
            'The run is taking longer than usual. Try again in a moment.',
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        r = await examsApi.getRun(sessionId, r.id);
      }
      if (alive.current) setRun(r);
    } catch (err) {
      setRunError(
        err instanceof ApiError && err.code === 'RUN_COOLDOWN'
          ? 'Please wait a few seconds between runs.'
          : errorMessage(err),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.codingLayout}>
      <article className={`${styles.questionCard} ${styles.statement}`}>
        {header}
        {statement}
        <p className={styles.limits}>
          Time limit {coding.timeLimitMs / 1000} s · Memory{' '}
          {coding.memoryLimitMb} MB
        </p>
        {coding.sampleTestCases.map((t, i) => (
          <div key={i} className={styles.sample}>
            <strong>Example {i + 1}</strong>
            <div className={styles.ioGrid}>
              <div>
                <span>Input</span>
                <pre>{t.input || '(empty)'}</pre>
              </div>
              <div>
                <span>Output</span>
                <pre>{t.expectedOutput}</pre>
              </div>
            </div>
          </div>
        ))}
      </article>

      <section className={styles.editorPane} aria-label="Your code">
        <div className={styles.editorToolbar}>
          <label>
            <span className="sr-only">Language</span>
            <select
              className={styles.langSelect}
              value={language}
              onChange={(e) => switchLanguage(e.target.value as Language)}
            >
              {coding.languages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          {saved && saved.language !== language && (
            <small className={styles.muted}>
              Your {LANGUAGE_LABELS[saved.language]} answer will be submitted.
            </small>
          )}
          <button
            type="button"
            className={btn.secondary}
            onClick={() => edit(coding.starterCode[language] ?? '')}
            disabled={code === (coding.starterCode[language] ?? '')}
          >
            Reset
          </button>
          <button
            type="button"
            className={btn.primary}
            onClick={() => void runSamples()}
            disabled={running || !code.trim()}
          >
            {running ? 'Running…' : 'Run sample tests'}
          </button>
        </div>
        <div className={styles.editor}>
          <Suspense fallback={<p aria-busy="true">Loading editor…</p>}>
            <CodeEditor
              language={language}
              value={code}
              onChange={edit}
              label={`Code editor, ${LANGUAGE_LABELS[language]}`}
            />
          </Suspense>
        </div>
        <RunOutput run={run} error={runError} />
      </section>
    </div>
  );
}

function RunOutput({ run, error }: { run: CodeRun | null; error: string }) {
  if (error)
    return (
      <div className={styles.runPanel} role="alert">
        {error}
      </div>
    );
  if (!run) return null;
  if (run.status === 'failed')
    return (
      <div className={styles.runPanel} role="status">
        {run.message ?? 'This run couldn’t be completed. Please try again.'}
      </div>
    );
  if (run.verdict === 'CE')
    return (
      <div className={styles.runPanel} role="status">
        <strong data-verdict="CE">Compilation error</strong>
        {run.compileOutput && (
          <pre className={styles.stderr}>{run.compileOutput}</pre>
        )}
      </div>
    );
  return (
    <div className={styles.runPanel} role="status">
      <strong>
        {run.passedCount} / {run.totalCount} sample tests passed
      </strong>
      {run.results.map((r, i) => (
        <details key={i} className={styles.runCase} open={r.verdict !== 'AC'}>
          <summary>
            Example {i + 1}:{' '}
            <span data-verdict={r.verdict}>{VERDICT_LABEL[r.verdict]}</span>
            {r.timeMs !== null && ` · ${r.timeMs} ms`}
            {r.memoryKb !== null && ` · ${Math.round(r.memoryKb / 1024)} MB`}
          </summary>
          <div className={styles.ioGrid}>
            <div>
              <span>Expected</span>
              <pre>{r.expectedOutput}</pre>
            </div>
            <div>
              <span>Your output</span>
              <pre>{r.stdout || '(no output)'}</pre>
            </div>
          </div>
          {r.stderr && (
            <div>
              <span>Errors</span>
              <pre className={styles.stderr}>{r.stderr}</pre>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
