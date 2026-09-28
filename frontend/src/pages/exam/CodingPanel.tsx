import { lazy, Suspense, useState, type ReactNode } from 'react';
import btn from '../../components/ui/Button.module.css';
import {
  examsApi,
  type CodingResponse,
  type RunResult,
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

const VERDICT_LABEL: Record<RunResult['results'][number]['verdict'], string> = {
  passed: 'Passed',
  failed: 'Wrong output',
  runtime_error: 'Runtime error',
  time_limit: 'Time limit exceeded',
  unsupported: 'Can’t run',
};

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
  const [run, setRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

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
    try {
      setRun(await examsApi.run(sessionId, item.id, language, code));
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

function RunOutput({ run, error }: { run: RunResult | null; error: string }) {
  if (error)
    return (
      <div className={styles.runPanel} role="alert">
        {error}
      </div>
    );
  if (!run) return null;
  if (run.status === 'unavailable' || run.results.length === 0)
    return (
      <div className={styles.runPanel} role="status">
        {run.message ?? 'Nothing to run.'}
      </div>
    );
  const passed = run.results.filter((r) => r.verdict === 'passed').length;
  return (
    <div className={styles.runPanel} role="status">
      <strong>
        {passed} / {run.results.length} sample tests passed
      </strong>
      {run.message && <p className={styles.muted}>{run.message}</p>}
      {run.results.map((r, i) => (
        <details
          key={i}
          className={styles.runCase}
          open={r.verdict !== 'passed'}
        >
          <summary>
            Example {i + 1}:{' '}
            <span data-verdict={r.verdict}>{VERDICT_LABEL[r.verdict]}</span>
            {r.verdict !== 'unsupported' && ` · ${r.timeMs} ms`}
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
