import type { CodingLanguage } from '../../question-bank/models/question-content.js';
import { outputsMatch } from '../../exams/models/session-content.js';

export type TestVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'IE';

/** How one test case ran, as reported by a code runner (before comparing output). */
export interface TestOutcome {
  status:
    | 'ok'
    | 'time_limit'
    | 'memory_limit'
    | 'runtime_error'
    | 'compile_error'
    | 'internal_error';
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

const STATUS_VERDICT: Record<
  Exclude<TestOutcome['status'], 'ok'>,
  TestVerdict
> = {
  time_limit: 'TLE',
  memory_limit: 'MLE',
  runtime_error: 'RE',
  compile_error: 'CE',
  internal_error: 'IE',
};

/** Verdict for one test case: a clean run is AC if the output matches (see `outputsMatch`). */
export function verdictFor(
  outcome: TestOutcome,
  expectedOutput: string,
): TestVerdict {
  if (outcome.status !== 'ok') return STATUS_VERDICT[outcome.status];
  return outputsMatch(outcome.stdout, expectedOutput) ? 'AC' : 'WA';
}

/** Overall verdict: CE if it didn't compile, AC if every test passed, else the first failure. */
export function overallVerdict(verdicts: TestVerdict[]): TestVerdict {
  if (verdicts.includes('CE')) return 'CE';
  return verdicts.find((v) => v !== 'AC') ?? 'AC';
}

/**
 * Per-language allowances on top of each question's limits (FRD §4.7):
 * interpreted/JIT languages get more time, the JVM more memory. Judge0
 * language ids are for Judge0 CE 1.13 (Python 3.8, Node 12, OpenJDK 13, GCC 9).
 */
export const LANGUAGES: Record<
  CodingLanguage,
  { timeFactor: number; extraMemoryMb: number; judge0Id: number; file: string }
> = {
  cpp: { timeFactor: 1, extraMemoryMb: 0, judge0Id: 54, file: 'main.cpp' },
  java: { timeFactor: 2, extraMemoryMb: 128, judge0Id: 62, file: 'Main.java' },
  python: { timeFactor: 3, extraMemoryMb: 0, judge0Id: 71, file: 'main.py' },
  javascript: {
    timeFactor: 2,
    extraMemoryMb: 64,
    judge0Id: 63,
    file: 'main.js',
  },
};

/** Hard caps (Judge0's defaults: 15 s CPU, 512 MB). */
export const MAX_TIME_MS = 15_000;
export const MAX_MEMORY_MB = 512;

export function effectiveLimits(
  language: CodingLanguage,
  timeLimitMs: number,
  memoryLimitMb: number,
) {
  const l = LANGUAGES[language];
  return {
    timeLimitMs: Math.min(MAX_TIME_MS, Math.round(timeLimitMs * l.timeFactor)),
    memoryLimitMb: Math.min(MAX_MEMORY_MB, memoryLimitMb + l.extraMemoryMb),
  };
}

// ── Scoring (all scores in hundredths of a mark: integers, no floats) ──

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'unanswered';

export interface Graded {
  scoreCenti: number;
  outcome: Outcome;
}

/**
 * MCQ against the answer key with the section's marking scheme:
 * - exact match → full marks
 * - any wrong option chosen → wrong: minus `negativeMarkPercent` of the marks
 * - multi-answer, only correct options but not all of them → with partial
 *   scoring, marks × (correct chosen / correct total); without, it's wrong
 * - no answer → 0
 */
export function gradeMcq(
  item: { marks: number; negativeMarkPercent: number; partialScoring: boolean },
  options: { id: string; isCorrect: boolean }[],
  chosen: string[] | null,
): Graded {
  if (!chosen?.length) return { scoreCenti: 0, outcome: 'unanswered' };
  const correct = new Set(options.filter((o) => o.isCorrect).map((o) => o.id));
  const picked = new Set(chosen);
  const wrongPicked = [...picked].some((id) => !correct.has(id));
  const rightPicked = [...picked].filter((id) => correct.has(id)).length;
  const full = item.marks * 100;
  const penalty = 0 - Math.round((full * item.negativeMarkPercent) / 100);

  if (!wrongPicked && rightPicked === correct.size)
    return { scoreCenti: full, outcome: 'correct' };
  if (!wrongPicked && item.partialScoring)
    return {
      scoreCenti: Math.floor((full * rightPicked) / correct.size),
      outcome: 'partial',
    };
  return { scoreCenti: penalty, outcome: 'incorrect' };
}

/**
 * Coding: with partial scoring, marks × (passed test weight / total weight);
 * without, all tests must pass. Never negative. CE scores 0.
 */
export function gradeCoding(
  item: { marks: number; partialScoring: boolean },
  tests: { verdict: TestVerdict; weight: number }[] | null,
): Graded {
  if (!tests) return { scoreCenti: 0, outcome: 'unanswered' };
  const total = tests.reduce((a, t) => a + t.weight, 0);
  const passed = tests
    .filter((t) => t.verdict === 'AC')
    .reduce((a, t) => a + t.weight, 0);
  const full = item.marks * 100;
  if (total > 0 && passed === total)
    return { scoreCenti: full, outcome: 'correct' };
  if (passed > 0 && item.partialScoring)
    return {
      scoreCenti: Math.floor((full * passed) / total),
      outcome: 'partial',
    };
  return { scoreCenti: 0, outcome: 'incorrect' };
}

/** Hundredths of a mark → marks, for API responses (e.g. 1850 → 18.5). */
export const centiToMarks = (c: number | null) => (c === null ? null : c / 100);
