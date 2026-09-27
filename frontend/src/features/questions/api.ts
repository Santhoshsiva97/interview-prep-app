import {
  apiDelete,
  apiFetch,
  apiFetchText,
  apiPatch,
  apiPost,
  apiPut,
} from '../../lib/api';

// Mirrors backend/src/modules/question-bank.

export type QuestionType = 'mcq' | 'coding';
export type QuestionStatus =
  'draft' | 'pending_review' | 'published' | 'rejected' | 'archived';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type TagKind = 'skill' | 'company';
export const LANGUAGES = ['python', 'javascript', 'java', 'cpp'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Topic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  questionCount: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  kind: TagKind;
  questionCount?: number;
}

export interface McqOption {
  id?: string;
  text: string;
  isCorrect: boolean;
}

export interface TestCase {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  weight: number;
}

export type QuestionContent =
  | { mcq: { options: Required<McqOption>[]; allowMultiple: boolean } }
  | {
      coding: {
        timeLimitMs: number;
        memoryLimitMb: number;
        starterCode: Partial<Record<Language, string>>;
        testCases: TestCase[];
      };
    };

export interface QuestionInput {
  type: QuestionType;
  title: string;
  body: string;
  topicId: string;
  difficulty: Difficulty;
  explanation?: string;
  marks: number;
  tagIds: string[];
  mcq?: { options: McqOption[]; allowMultiple: boolean };
  coding?: {
    timeLimitMs: number;
    memoryLimitMb: number;
    starterCode: Partial<Record<Language, string>>;
    testCases: TestCase[];
  };
  changeNote?: string;
}

interface Person {
  id: string;
  name: string;
}

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  status: QuestionStatus;
  title: string;
  difficulty: Difficulty;
  externalId: string | null;
  topic: { id: string; name: string; slug: string };
  tags: Tag[];
  currentVersion: number | null;
  liveVersion: number | null;
  author: Person | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface QuestionVersion {
  versionNumber: number;
  title: string;
  body: string;
  difficulty: Difficulty;
  topicId: string;
  explanation: string | null;
  marks: number;
  content: QuestionContent;
  changeNote: string | null;
  createdAt: string;
  createdBy: Person | null;
}

export interface QuestionDetail extends QuestionSummary {
  version: QuestionVersion;
  history: {
    versionNumber: number;
    changeNote: string | null;
    createdAt: string;
    createdBy: Person | null;
    isCurrent: boolean;
    isLive: boolean;
  }[];
  submittedBy: Person | null;
  reviewedBy: Person | null;
}

export interface QuestionList {
  items: QuestionSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statusCounts: Partial<Record<QuestionStatus, number>>;
}

export interface FieldProblem {
  field: string;
  message: string;
}

export interface ImportRow {
  row: number;
  externalId: string | null;
  title: string | null;
  action: 'create' | 'update' | 'unchanged' | 'error';
  questionId?: string;
  errors: FieldProblem[];
}

export interface ImportReport {
  importId: string | null;
  dryRun: boolean;
  format: 'csv' | 'json';
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  rows: ImportRow[];
  newTaxonomy: { topics: string[]; tags: string[] };
}

export interface ImportRecord {
  id: string;
  fileName: string;
  format: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  createdAt: string;
  uploadedBy: Person | null;
}

export type WorkflowAction =
  'submit' | 'withdraw' | 'approve' | 'reject' | 'archive' | 'restore';

export const STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Published',
  rejected: 'Changes requested',
  archived: 'Archived',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  java: 'Java',
  cpp: 'C++',
};

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

export const questionsApi = {
  list: (q: Record<string, string | number | undefined>) =>
    apiFetch<QuestionList>(`/admin/questions?${qs(q)}`),
  get: (id: string) => apiFetch<QuestionDetail>(`/admin/questions/${id}`),
  version: (id: string, n: number) =>
    apiFetch<QuestionVersion>(`/admin/questions/${id}/versions/${n}`),
  create: (input: QuestionInput) =>
    apiPost<QuestionDetail>('/admin/questions', input),
  update: (id: string, input: QuestionInput) =>
    apiPut<{ question: QuestionDetail; changed: boolean }>(
      `/admin/questions/${id}`,
      input,
    ),
  transition: (id: string, action: WorkflowAction, note?: string) =>
    apiPost<QuestionDetail>(
      `/admin/questions/${id}/${action}`,
      action === 'reject' ? { note } : undefined,
    ),

  topics: () => apiFetch<Topic[]>('/admin/topics'),
  createTopic: (t: {
    name: string;
    slug?: string;
    description?: string;
    sortOrder?: number;
  }) => apiPost<Topic>('/admin/topics', t),
  updateTopic: (
    id: string,
    t: Partial<Pick<Topic, 'name' | 'slug' | 'description' | 'sortOrder'>>,
  ) => apiPatch<Topic>(`/admin/topics/${id}`, t),
  deleteTopic: (id: string) => apiDelete<void>(`/admin/topics/${id}`),
  tags: () => apiFetch<Tag[]>('/admin/tags'),
  createTag: (t: { name: string; slug?: string; kind: TagKind }) =>
    apiPost<Tag>('/admin/tags', t),
  updateTag: (id: string, t: Partial<Pick<Tag, 'name' | 'slug' | 'kind'>>) =>
    apiPatch<Tag>(`/admin/tags/${id}`, t),
  deleteTag: (id: string) => apiDelete<void>(`/admin/tags/${id}`),

  import: (
    file: File,
    opts: {
      dryRun: boolean;
      submitForReview: boolean;
      createMissingTaxonomy: boolean;
    },
  ) => {
    const form = new FormData();
    form.append('file', file);
    return apiPost<ImportReport>(
      `/admin/question-imports?${qs({
        dryRun: String(opts.dryRun),
        submitForReview: String(opts.submitForReview),
        createMissingTaxonomy: String(opts.createMissingTaxonomy),
      })}`,
      form,
    );
  },
  importHistory: () => apiFetch<ImportRecord[]>('/admin/question-imports'),
  template: (format: 'csv' | 'json') =>
    apiFetchText(`/admin/question-imports/template?format=${format}`),
};

/** Saves text as a file in the browser. */
export function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: fileName,
  });
  a.click();
  URL.revokeObjectURL(url);
}
