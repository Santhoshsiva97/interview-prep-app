import type {
  Difficulty,
  Language,
  McqOption,
  QuestionDetail,
  QuestionInput,
  QuestionType,
} from './api';

/** Editor state (numbers kept as strings while typing). */
export interface QuestionFormState {
  type: QuestionType;
  title: string;
  body: string;
  topicId: string;
  difficulty: Difficulty;
  marks: string;
  explanation: string;
  tagIds: string[];
  mcq: { allowMultiple: boolean; options: McqOption[] };
  coding: {
    timeLimitMs: string;
    memoryLimitMb: string;
    starterCode: Partial<Record<Language, string>>;
    testCases: {
      input: string;
      expectedOutput: string;
      isSample: boolean;
      weight: string;
    }[];
  };
  changeNote: string;
}

export function blankForm(type: QuestionType): QuestionFormState {
  return {
    type,
    title: '',
    body: '',
    topicId: '',
    difficulty: 'easy',
    marks: type === 'coding' ? '10' : '1',
    explanation: '',
    tagIds: [],
    mcq: {
      allowMultiple: false,
      options: [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
      ],
    },
    coding: {
      timeLimitMs: '2000',
      memoryLimitMb: '256',
      starterCode: { python: '' },
      testCases: [
        { input: '', expectedOutput: '', isSample: true, weight: '1' },
        { input: '', expectedOutput: '', isSample: false, weight: '1' },
      ],
    },
    changeNote: '',
  };
}

export function formFromQuestion(q: QuestionDetail): QuestionFormState {
  const v = q.version;
  const base = blankForm(q.type);
  return {
    ...base,
    title: v.title,
    body: v.body,
    topicId: v.topicId,
    difficulty: v.difficulty,
    marks: String(v.marks),
    explanation: v.explanation ?? '',
    tagIds: q.tags.map((t) => t.id),
    mcq:
      'mcq' in v.content
        ? {
            ...v.content.mcq,
            options: v.content.mcq.options.map((o) => ({ ...o })),
          }
        : base.mcq,
    coding:
      'coding' in v.content
        ? {
            timeLimitMs: String(v.content.coding.timeLimitMs),
            memoryLimitMb: String(v.content.coding.memoryLimitMb),
            starterCode: { ...v.content.coding.starterCode },
            testCases: v.content.coding.testCases.map((t) => ({
              ...t,
              weight: String(t.weight),
            })),
          }
        : base.coding,
  };
}

const int = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

export function formToInput(f: QuestionFormState): QuestionInput {
  return {
    type: f.type,
    title: f.title,
    body: f.body,
    topicId: f.topicId,
    difficulty: f.difficulty,
    marks: int(f.marks, 1),
    explanation: f.explanation.trim() || undefined,
    tagIds: f.tagIds,
    changeNote: f.changeNote.trim() || undefined,
    ...(f.type === 'mcq'
      ? { mcq: { allowMultiple: f.mcq.allowMultiple, options: f.mcq.options } }
      : {
          coding: {
            timeLimitMs: int(f.coding.timeLimitMs, 2000),
            memoryLimitMb: int(f.coding.memoryLimitMb, 256),
            starterCode: f.coding.starterCode,
            testCases: f.coding.testCases.map((t) => ({
              ...t,
              weight: int(t.weight, 1),
            })),
          },
        }),
  };
}

/** Comparison key for "unsaved changes" (ignores the change note). */
export const formKey = (f: QuestionFormState) =>
  JSON.stringify({ ...f, changeNote: '' });
