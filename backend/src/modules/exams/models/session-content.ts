import {
  CODING_LANGUAGES,
  type CodingLanguage,
  type QuestionContent,
} from '../../question-bank/models/question-content.js';

/** Stored in exam_sessions.snapshot: the exam as it was when the attempt started. */
export interface SessionSnapshot {
  settings: {
    title: string;
    kind: 'mock_exam' | 'virtual_interview';
    durationMinutes: number;
    sectionTimed: boolean;
    pauseOnDisconnect: boolean;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    passPercent: number | null;
    /** Missing on attempts started before Step 9 (treated as `full`). */
    answerReview?: 'full' | 'own_answers' | 'none';
  };
  sections: {
    title: string;
    description: string | null;
    durationMinutes: number | null;
    marksPerQuestion: number | null;
    negativeMarkPercent: number;
    partialScoring: boolean;
    questionCount: number;
  }[];
}

export const sectionDurationsMs = (s: SessionSnapshot) =>
  s.settings.sectionTimed
    ? s.sections.map((x) => (x.durationMinutes ?? 0) * 60_000)
    : null;

/** Saved answers (exam_session_items.response). */
export type McqResponse = { optionIds: string[] };
export type CodingResponse = {
  /** Language the candidate submits in. */
  language: CodingLanguage;
  /** Code per language, so switching languages doesn't lose work. */
  sources: Partial<Record<CodingLanguage, string>>;
};
export type ItemResponse = McqResponse | CodingResponse;

export const SOURCE_MAX_BYTES = 64 * 1024;

/** What a candidate may see of a question: no answer key, explanation or hidden tests. */
export type CandidateQuestion =
  | {
      title: string;
      body: string;
      difficulty: string;
      mcq: { allowMultiple: boolean; options: { id: string; text: string }[] };
    }
  | {
      title: string;
      body: string;
      difficulty: string;
      coding: {
        timeLimitMs: number;
        memoryLimitMb: number;
        languages: CodingLanguage[];
        starterCode: Partial<Record<CodingLanguage, string>>;
        sampleTestCases: { input: string; expectedOutput: string }[];
      };
    };

export function candidateQuestion(
  version: {
    title: string;
    body: string;
    difficulty: string;
    content: unknown;
  },
  optionOrder: string[] | null,
): CandidateQuestion {
  const content = version.content as QuestionContent;
  const base = {
    title: version.title,
    body: version.body,
    difficulty: version.difficulty,
  };
  if ('mcq' in content) {
    const byId = new Map(content.mcq.options.map((o) => [o.id, o]));
    const order = optionOrder ?? content.mcq.options.map((o) => o.id);
    return {
      ...base,
      mcq: {
        allowMultiple: content.mcq.allowMultiple,
        options: order
          .map((id) => byId.get(id))
          .filter((o) => o !== undefined)
          .map((o) => ({ id: o.id, text: o.text })),
      },
    };
  }
  return {
    ...base,
    coding: {
      timeLimitMs: content.coding.timeLimitMs,
      memoryLimitMb: content.coding.memoryLimitMb,
      languages: [...CODING_LANGUAGES],
      starterCode: content.coding.starterCode,
      sampleTestCases: content.coding.testCases
        .filter((t) => t.isSample)
        .map((t) => ({ input: t.input, expectedOutput: t.expectedOutput })),
    },
  };
}

/**
 * Checks and normalises a candidate's answer against the pinned question
 * version. Returns `null` for "cleared" answers, or an error message.
 */
export function normaliseResponse(
  raw: unknown,
  content: QuestionContent,
): { ok: true; value: ItemResponse | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'Answer must be an object' };
  const r = raw as Record<string, unknown>;

  if ('mcq' in content) {
    const ids = r.optionIds;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
      return { ok: false, error: 'optionIds must be a list of option ids' };
    const unique = [...new Set(ids)];
    const known = new Set(content.mcq.options.map((o) => o.id));
    if (unique.some((id) => !known.has(id)))
      return { ok: false, error: 'Unknown option' };
    if (!content.mcq.allowMultiple && unique.length > 1)
      return { ok: false, error: 'Only one option can be chosen' };
    return { ok: true, value: unique.length ? { optionIds: unique } : null };
  }

  const language = r.language;
  if (!isLanguage(language))
    return {
      ok: false,
      error: `language must be one of ${CODING_LANGUAGES.join(', ')}`,
    };
  const rawSources = r.sources;
  if (
    !rawSources ||
    typeof rawSources !== 'object' ||
    Array.isArray(rawSources)
  )
    return { ok: false, error: 'sources must map language to code' };
  const sources: CodingResponse['sources'] = {};
  for (const [lang, code] of Object.entries(rawSources)) {
    if (!isLanguage(lang))
      return { ok: false, error: `Unsupported language ${lang}` };
    if (typeof code !== 'string')
      return { ok: false, error: 'Code must be text' };
    if (Buffer.byteLength(code) > SOURCE_MAX_BYTES)
      return { ok: false, error: 'Code is too long (64 KB max)' };
    sources[lang] = code;
  }
  if (!sources[language]?.trim()) return { ok: true, value: null };
  return { ok: true, value: { language, sources } };
}

export const isLanguage = (x: unknown): x is CodingLanguage =>
  typeof x === 'string' && (CODING_LANGUAGES as readonly string[]).includes(x);

/** Fisher–Yates on a copy. `random` is injectable for tests. */
export function shuffled<T>(xs: readonly T[], random = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Output comparison used when running code against test cases: line endings
 * are normalised, trailing whitespace on each line and trailing blank lines
 * are ignored. Step 8's grader should use the same rule.
 */
export function outputsMatch(actual: string, expected: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}
