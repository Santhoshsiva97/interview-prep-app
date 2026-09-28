import { apiFetch, apiFetchText } from '../../lib/api';
import type { ExamKind } from '../exams/api';
import type { Difficulty, QuestionType } from '../questions/api';
import { downloadText } from '../questions/api';

// Mirrors backend/src/modules/analytics. Percentages are 0–100.

export type Strength = 'strong' | 'developing' | 'weak' | 'not_enough_data';

export const STRENGTH_LABELS: Record<Strength, string> = {
  strong: 'Strong',
  developing: 'Developing',
  weak: 'Needs work',
  not_enough_data: 'Not enough data',
};

export interface MasteryView {
  questions: number;
  answered: number;
  correct: number;
  mastery: number;
  accuracy: number;
  avgTimeMs: number;
  strength: Strength;
}

export interface Insights {
  totals: {
    testsCompleted: number;
    questionsAnswered: number;
    averagePercent: number | null;
    bestPercent: number | null;
    timeSpentMs: number;
    overall: MasteryView;
  };
  topics: (MasteryView & { topicId: string; name: string })[];
  difficulty: (MasteryView & { difficulty: Difficulty })[];
  trend: {
    sessionId: string;
    examId: string;
    title: string;
    attemptNumber: number;
    submittedAt: string;
    percent: number;
  }[];
  recommendations: {
    examId: string;
    title: string;
    kind: ExamKind;
    durationMinutes: number;
    questionCount: number;
    difficulty: Difficulty;
    weakTopics: string[];
  }[];
}

export interface DailyPoint {
  day: string;
  signups: number;
  activeUsers: number;
  attemptsStarted: number;
  attemptsSubmitted: number;
  avgPercent: number | null;
}

export interface Overview {
  kpis: {
    dau: number;
    wau: number;
    mau: number;
    stickinessBp: number;
    attempts7d: number;
    attempts30d: number;
    graded30d: number;
    avgPercent30d: number | null;
  };
  daily: DailyPoint[];
}

export type QuestionFlag = 'too_easy' | 'too_hard' | 'unused';

export const FLAG_LABELS: Record<QuestionFlag, string> = {
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  unused: 'Unused',
};

export interface QuestionStatRow {
  questionId: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  topic: { id: string; name: string };
  attempts: number;
  answered: number;
  correct: number;
  partial: number;
  incorrect: number;
  accuracy: number | null;
  avgScore: number | null;
  avgTimeMs: number | null;
  lastAttemptAt: string | null;
  flags: QuestionFlag[];
}

export interface QuestionStats {
  rows: QuestionStatRow[];
  total: number;
  computedAt: string | null;
  thresholds: { minAttempts: number; tooEasy: number; tooHard: number };
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

/** Downloads `path?…&format=csv` (with auth) as a file. */
async function downloadCsv(
  path: string,
  params: Record<string, string | number | undefined>,
  fileName: string,
) {
  const text = await apiFetchText(
    `${path}?${qs({ ...params, format: 'csv' })}`,
  );
  downloadText(fileName, text, 'text/csv;charset=utf-8');
}

const today = () => new Date().toISOString().slice(0, 10);

export const analyticsApi = {
  insights: () => apiFetch<Insights>('/insights'),
  insightsCsv: () =>
    downloadCsv('/insights', {}, `my-topic-insights-${today()}.csv`),
  overview: (days: number) =>
    apiFetch<Overview>(`/admin/analytics/overview?${qs({ days })}`),
  overviewCsv: (days: number) =>
    downloadCsv(
      '/admin/analytics/overview',
      { days },
      `platform-daily-${today()}.csv`,
    ),
  questions: (params: Record<string, string | undefined>) =>
    apiFetch<QuestionStats>(`/admin/analytics/questions?${qs(params)}`),
  questionsCsv: (params: Record<string, string | undefined>) =>
    downloadCsv(
      '/admin/analytics/questions',
      params,
      `question-stats-${today()}.csv`,
    ),
  refreshQuestions: () =>
    apiFetch<{ queued: boolean; lastComputedAt: string | null }>(
      '/admin/analytics/questions/refresh',
      { method: 'POST' },
    ),
};
