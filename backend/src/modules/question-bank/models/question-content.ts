import { randomBytes } from 'node:crypto';

/** Languages the code judge will support (Step 8). */
export const CODING_LANGUAGES = [
  'python',
  'javascript',
  'java',
  'cpp',
] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

export interface McqOption {
  /** Stable id (kept across versions) so answer keys can reference it. */
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface McqContent {
  options: McqOption[];
  allowMultiple: boolean;
}

export interface TestCase {
  input: string;
  expectedOutput: string;
  /** Shown to candidates as an example; hidden cases are only used for grading. */
  isSample: boolean;
  weight: number;
}

export interface CodingContent {
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode: Partial<Record<CodingLanguage, string>>;
  testCases: TestCase[];
}

/** Stored in question_versions.content. */
export type QuestionContent = { mcq: McqContent } | { coding: CodingContent };

export interface FieldProblem {
  field: string;
  message: string;
}

export const LIMITS = {
  mcqOptions: { min: 2, max: 8 },
  testCases: { min: 1, max: 100 },
  testCaseBytes: 64 * 1024,
  starterCodeBytes: 32 * 1024,
  tags: 20,
} as const;

const newOptionId = () => randomBytes(4).toString('hex');

/**
 * Rules that span several fields (single-field rules live on the DTOs).
 * Shared by the editor API and bulk import so both reject the same things.
 */
export function contentProblems(input: {
  type: 'mcq' | 'coding';
  mcq?: {
    options?: { text?: string; isCorrect?: boolean }[];
    allowMultiple?: boolean;
  };
  coding?: {
    testCases?: { isSample?: boolean }[];
    starterCode?: Record<string, unknown>;
  };
}): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (input.type === 'mcq') {
    if (!input.mcq)
      return [{ field: 'mcq', message: 'MCQ questions need options' }];
    if (input.coding)
      problems.push({
        field: 'coding',
        message: 'MCQ questions can’t have coding settings',
      });
    const options = input.mcq.options ?? [];
    const correct = options.filter((o) => o.isCorrect).length;
    if (correct === 0) {
      problems.push({
        field: 'mcq.options',
        message: 'Mark at least one option as correct',
      });
    } else if (!input.mcq.allowMultiple && correct > 1) {
      problems.push({
        field: 'mcq.options',
        message:
          'Only one option can be correct unless “multiple correct answers” is on',
      });
    }
    const texts = options.map((o) => (o.text ?? '').trim().toLowerCase());
    if (new Set(texts).size !== texts.length) {
      problems.push({
        field: 'mcq.options',
        message: 'Options must be different from each other',
      });
    }
  } else {
    if (!input.coding)
      return [{ field: 'coding', message: 'Coding questions need test cases' }];
    if (input.mcq)
      problems.push({
        field: 'mcq',
        message: 'Coding questions can’t have options',
      });
    const cases = input.coding.testCases ?? [];
    if (!cases.some((c) => c.isSample)) {
      problems.push({
        field: 'coding.testCases',
        message: 'Add at least one sample test case',
      });
    }
    if (!cases.some((c) => !c.isSample)) {
      problems.push({
        field: 'coding.testCases',
        message: 'Add at least one hidden test case',
      });
    }
    for (const lang of Object.keys(input.coding.starterCode ?? {})) {
      if (!(CODING_LANGUAGES as readonly string[]).includes(lang)) {
        problems.push({
          field: `coding.starterCode.${lang}`,
          message: `Unsupported language (use ${CODING_LANGUAGES.join(', ')})`,
        });
      }
    }
  }
  return problems;
}

/** Canonical, storable content. Assigns ids to new MCQ options. */
export function buildContent(input: {
  type: 'mcq' | 'coding';
  mcq?: {
    options: { id?: string; text: string; isCorrect: boolean }[];
    allowMultiple: boolean;
  };
  coding?: {
    timeLimitMs: number;
    memoryLimitMb: number;
    starterCode?: Record<string, string>;
    testCases: TestCase[];
  };
}): QuestionContent {
  if (input.type === 'mcq') {
    const seen = new Set<string>();
    return {
      mcq: {
        allowMultiple: input.mcq!.allowMultiple,
        options: input.mcq!.options.map((o) => {
          let id = o.id && !seen.has(o.id) ? o.id : newOptionId();
          while (seen.has(id)) id = newOptionId();
          seen.add(id);
          return { id, text: o.text.trim(), isCorrect: o.isCorrect };
        }),
      },
    };
  }
  const c = input.coding!;
  const starterCode: Partial<Record<CodingLanguage, string>> = {};
  for (const lang of CODING_LANGUAGES) {
    const code = c.starterCode?.[lang];
    if (code?.trim()) starterCode[lang] = code;
  }
  return {
    coding: {
      timeLimitMs: c.timeLimitMs,
      memoryLimitMb: c.memoryLimitMb,
      starterCode,
      testCases: c.testCases.map((t) => ({
        input: t.input,
        expectedOutput: t.expectedOutput,
        isSample: t.isSample,
        weight: t.weight,
      })),
    },
  };
}

/**
 * Comparable form of a version (ignores MCQ option ids, which are
 * generated), used to skip creating a version when nothing changed.
 */
export function contentFingerprint(v: {
  title: string;
  body: string;
  difficulty: string;
  topicId: string;
  explanation: string | null;
  marks: number;
  content: QuestionContent;
}): string {
  const content =
    'mcq' in v.content
      ? {
          mcq: {
            allowMultiple: v.content.mcq.allowMultiple,
            options: v.content.mcq.options.map((o) => [o.text, o.isCorrect]),
          },
        }
      : v.content;
  return stableStringify([
    v.title,
    v.body,
    v.difficulty,
    v.topicId,
    v.explanation ?? null,
    v.marks,
    content,
  ]);
}

/**
 * JSON.stringify with object keys sorted. Postgres jsonb doesn't preserve key
 * order, so plain stringify would see stored content as "changed".
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
