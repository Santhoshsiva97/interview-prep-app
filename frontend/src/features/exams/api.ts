import { apiDelete, apiFetch, apiPatch, apiPost, apiPut } from '../../lib/api';
import type { Difficulty, Language, QuestionStatus } from '../questions/api';

// Mirrors backend/src/modules/exams.

export type ExamKind = 'mock_exam' | 'virtual_interview';
export type ExamStatus = 'draft' | 'published' | 'archived';
export type SubmitReason = 'manual' | 'time_expired' | 'abandoned';

export const KIND_LABELS: Record<ExamKind, string> = {
  mock_exam: 'Mock test',
  virtual_interview: 'Virtual interview',
};

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

interface Person {
  id: string;
  name: string;
}

// ── Admin: builder ──

export interface ExamSectionInput {
  title: string;
  description?: string | null;
  durationMinutes?: number | null;
  marksPerQuestion?: number | null;
  negativeMarkPercent: number;
  partialScoring: boolean;
  questionIds: string[];
}

export interface ExamInput {
  title: string;
  kind: ExamKind;
  description?: string | null;
  instructions: string;
  durationMinutes: number;
  sectionTimed: boolean;
  pauseOnDisconnect: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxAttempts?: number | null;
  passPercent?: number | null;
  sections: ExamSectionInput[];
}

export interface ExamItemView {
  questionId: string;
  title: string;
  type: 'mcq' | 'coding';
  difficulty: Difficulty;
  questionStatus: QuestionStatus;
  topic: { id: string; name: string };
  marks: number;
  pinnedVersion: number | null;
  liveVersion: number | null;
}

export interface ExamDetail extends Omit<ExamInput, 'sections'> {
  id: string;
  status: ExamStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: Person | null;
  updatedBy: Person | null;
  publishedBy: Person | null;
  questionCount: number;
  totalMarks: number;
  sections: (Omit<ExamSectionInput, 'questionIds'> & {
    id: string;
    items: ExamItemView[];
  })[];
  publishProblems: { field: string; message: string }[];
}

export interface ExamListItem {
  id: string;
  title: string;
  kind: ExamKind;
  status: ExamStatus;
  durationMinutes: number;
  sectionTimed: boolean;
  sectionCount: number;
  questionCount: number;
  attemptCount: number;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: Person | null;
}

export interface ExamList {
  items: ExamListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statusCounts: Partial<Record<ExamStatus, number>>;
}

export type ExamAction = 'publish' | 'unpublish' | 'archive' | 'restore';

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return p.toString();
};

export const adminExamsApi = {
  list: (q: Record<string, string | undefined>) =>
    apiFetch<ExamList>(`/admin/exams?${qs(q)}`),
  get: (id: string) => apiFetch<ExamDetail>(`/admin/exams/${id}`),
  create: (input: ExamInput) => apiPost<ExamDetail>('/admin/exams', input),
  update: (id: string, input: ExamInput) =>
    apiPut<ExamDetail>(`/admin/exams/${id}`, input),
  remove: (id: string) => apiDelete<void>(`/admin/exams/${id}`),
  transition: (id: string, action: ExamAction) =>
    apiPost<ExamDetail>(`/admin/exams/${id}/${action}`),
};

// ── Candidate: catalog ──

export interface CatalogExam {
  id: string;
  title: string;
  kind: ExamKind;
  description: string | null;
  durationMinutes: number;
  sectionCount: number;
  questionCount: number;
  totalMarks: number;
  hasCoding: boolean;
  maxAttempts: number | null;
  attemptsUsed: number;
  inProgressSessionId: string | null;
  canStart: boolean;
  lastSubmittedAt: string | null;
}

export interface CatalogExamDetail extends CatalogExam {
  instructions: string;
  sectionTimed: boolean;
  pauseOnDisconnect: boolean;
  passPercent: number | null;
  sections: {
    title: string;
    description: string | null;
    durationMinutes: number | null;
    questionCount: number;
    mcqCount: number;
    codingCount: number;
    marks: number;
    negativeMarkPercent: number;
  }[];
}

export interface MySession {
  id: string;
  examId: string;
  title: string;
  kind: ExamKind;
  attemptNumber: number;
  status: 'in_progress' | 'submitted';
  submitReason: SubmitReason | null;
  startedAt: string;
  submittedAt: string | null;
  totalMarks: number;
  questionCount: number;
}

// ── Candidate: runtime ──

export type McqResponse = { optionIds: string[] };
export type CodingResponse = {
  language: Language;
  sources: Partial<Record<Language, string>>;
};
export type ItemResponse = McqResponse | CodingResponse;

export type RuntimeQuestion =
  | {
      title: string;
      body: string;
      difficulty: Difficulty;
      mcq: { allowMultiple: boolean; options: { id: string; text: string }[] };
    }
  | {
      title: string;
      body: string;
      difficulty: Difficulty;
      coding: {
        timeLimitMs: number;
        memoryLimitMb: number;
        languages: Language[];
        starterCode: Partial<Record<Language, string>>;
        sampleTestCases: { input: string; expectedOutput: string }[];
      };
    };

export interface SessionItem {
  id: string;
  sectionIndex: number;
  position: number;
  type: 'mcq' | 'coding';
  marks: number;
  negativeMarkPercent: number;
  markedForReview: boolean;
  visited: boolean;
  answered: boolean;
  timeSpentMs: number;
  response: ItemResponse | null;
  /** Null for locked sections and after submission. */
  question: RuntimeQuestion | null;
}

export interface SessionView {
  id: string;
  examId: string;
  status: 'in_progress' | 'submitted';
  submitReason: SubmitReason | null;
  submittedAt: string | null;
  startedAt: string;
  attemptNumber: number;
  exam: {
    title: string;
    kind: ExamKind;
    durationMinutes: number;
    sectionTimed: boolean;
    pauseOnDisconnect: boolean;
  };
  sections: {
    index: number;
    title: string;
    description: string | null;
    durationMinutes: number | null;
    questionCount: number;
    negativeMarkPercent: number;
    state: 'open' | 'done' | 'current' | 'upcoming';
  }[];
  currentSectionIndex: number;
  timeRemainingMs: number;
  sectionRemainingMs: number | null;
  serverTime: string;
  autosaveIntervalMs: number;
  totalMarks: number;
  items: SessionItem[];
}

export interface AnswerPatch {
  itemId: string;
  response?: ItemResponse | null;
  markedForReview?: boolean;
  visited?: boolean;
  timeSpentMs?: number;
}

export interface SyncResult {
  status: 'in_progress' | 'submitted';
  submitReason: SubmitReason | null;
  timeRemainingMs: number;
  sectionRemainingMs: number | null;
  currentSectionIndex: number;
  serverTime: string;
  rejected: { itemId: string; code: string; message: string }[];
}

export interface RunResult {
  status: 'completed' | 'unavailable';
  message: string | null;
  results: {
    verdict:
      'passed' | 'failed' | 'runtime_error' | 'time_limit' | 'unsupported';
    stdout: string;
    stderr: string;
    timeMs: number;
    input: string;
    expectedOutput: string;
  }[];
}

export const examsApi = {
  catalog: (kind?: ExamKind) =>
    apiFetch<CatalogExam[]>(`/exams?${qs({ kind })}`),
  get: (id: string) => apiFetch<CatalogExamDetail>(`/exams/${id}`),
  start: (id: string) =>
    apiPost<{ sessionId: string; resumed: boolean }>(`/exams/${id}/sessions`, {
      consent: true,
    }),
  mine: () => apiFetch<MySession[]>('/exam-sessions'),
  view: (id: string) => apiFetch<SessionView>(`/exam-sessions/${id}`),
  resume: (id: string) => apiPost<SessionView>(`/exam-sessions/${id}/resume`),
  save: (id: string, answers: AnswerPatch[]) =>
    apiPatch<SyncResult>(`/exam-sessions/${id}`, { answers }),
  nextSection: (id: string, answers: AnswerPatch[]) =>
    apiPost<SyncResult>(`/exam-sessions/${id}/next-section`, { answers }),
  submit: (id: string, answers: AnswerPatch[], auto: boolean) =>
    apiPost<SyncResult>(`/exam-sessions/${id}/submit`, { answers, auto }),
  run: (id: string, itemId: string, language: Language, code: string) =>
    apiPost<RunResult>(`/exam-sessions/${id}/run`, { itemId, language, code }),
};

/** 1h 05m / 12:05 style countdown. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const formatMinutes = (min: number) =>
  min >= 60
    ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
    : `${min} min`;
