import { apiFetch } from '../../lib/api';
import type {
  ExamKind,
  GradingStatus,
  ItemOutcome,
  SubmitReason,
  TestVerdict,
} from '../exams/api';
import type { Language } from '../questions/api';

// Mirrors backend/src/modules/scorecards. Scores are in marks (can be
// negative with negative marking); percentages are 0–100.

export type AnswerReviewPolicy = 'full' | 'own_answers' | 'none';

export const REVIEW_POLICY_LABELS: Record<AnswerReviewPolicy, string> = {
  full: 'Answers, correct answers and explanations',
  own_answers: 'Candidate’s own answers only (no answer key)',
  none: 'Scores only (no answer review)',
};

export interface ScoreSummary {
  score: number;
  maxScore: number;
  percent: number;
  /** Share of candidates' first attempts scoring lower (ties half). */
  percentile: number;
  cohortSize: number;
  /** Null when the exam has no pass mark. */
  passed: boolean | null;
}

export interface AttemptListItem {
  sessionId: string;
  examId: string;
  title: string;
  kind: ExamKind;
  attemptNumber: number;
  submittedAt: string;
  submitReason: SubmitReason | null;
  gradingStatus: GradingStatus | null;
  questionCount: number;
  result: ScoreSummary | null;
}

export interface Breakdown {
  scoreCenti: number;
  maxScoreCenti: number;
  score: number;
  maxScore: number;
  percent: number;
  questionCount: number;
  correct: number;
}

export interface SectionBreakdown extends Breakdown {
  index: number;
  title: string;
  partial: number;
  incorrect: number;
  unanswered: number;
  timeSpentMs: number;
}

export interface TopicBreakdown extends Breakdown {
  topicId: string;
  name: string;
}

export interface QuestionReview {
  body: string;
  /** Only with the `full` policy. */
  explanation: string | null;
  options:
    | {
        id: string;
        text: string;
        chosen: boolean;
        /** Null unless the policy shows the answer key. */
        isCorrect: boolean | null;
      }[]
    | null;
  code: {
    language: Language | null;
    source: string | null;
    verdict: TestVerdict | null;
    compileOutput: string | null;
    passedCount: number | null;
    totalCount: number | null;
    hiddenPassed: number;
    hiddenTotal: number;
    samples: {
      input: string;
      expectedOutput: string;
      output: string;
      verdict: TestVerdict;
      timeMs: number | null;
    }[];
  } | null;
}

export interface ScorecardQuestion {
  id: string;
  number: number;
  sectionIndex: number;
  sectionTitle: string;
  type: 'mcq' | 'coding';
  title: string;
  topic: string;
  marks: number;
  score: number | null;
  outcome: ItemOutcome | null;
  timeSpentMs: number;
  review: QuestionReview | null;
}

export interface Scorecard {
  sessionId: string;
  exam: {
    id: string;
    title: string;
    kind: ExamKind;
    passPercent: number | null;
    answerReview: AnswerReviewPolicy;
  };
  attemptNumber: number;
  startedAt: string;
  submittedAt: string;
  submitReason: SubmitReason | null;
  gradingStatus: GradingStatus | null;
  scorecard:
    | (ScoreSummary & {
        timeSpentMs: number;
        durationMs: number;
        sections: SectionBreakdown[];
        topics: TopicBreakdown[];
      })
    | null;
  questions: ScorecardQuestion[];
  history: {
    sessionId: string;
    attemptNumber: number;
    submittedAt: string;
    score: number;
    percent: number;
    current: boolean;
  }[];
}

export const scorecardsApi = {
  list: () => apiFetch<AttemptListItem[]>('/scorecards'),
  get: (sessionId: string) => apiFetch<Scorecard>(`/scorecards/${sessionId}`),
};

/** 18.5 → "18.5", 7 → "7", 6.75 → "6.75" */
export const fmtMarks = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

export const fmtPercent = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** 95_000 → "1m 35s", 4_000 → "4s" */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 1 → "1st", 22 → "22nd", 13 → "13th" */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const tens = r % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ??
        'th');
  return `${r}${suffix}`;
}
