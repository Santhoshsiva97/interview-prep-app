import type { QuestionContent } from '../../question-bank/models/question-content.js';
import {
  candidateQuestion,
  normaliseResponse,
  outputsMatch,
  shuffled,
} from './session-content.js';

const mcq = (allowMultiple = false): QuestionContent => ({
  mcq: {
    allowMultiple,
    options: [
      { id: 'a1', text: 'Yes', isCorrect: true },
      { id: 'b2', text: 'No', isCorrect: false },
      { id: 'c3', text: 'Maybe', isCorrect: false },
    ],
  },
});
const coding: QuestionContent = {
  coding: {
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: { python: 'print()' },
    testCases: [
      { input: '1', expectedOutput: '1', isSample: true, weight: 1 },
      { input: 'secret', expectedOutput: 'hidden', isSample: false, weight: 5 },
    ],
  },
};
const version = (content: QuestionContent) => ({
  title: 'Q',
  body: 'Body',
  difficulty: 'easy',
  content,
});

describe('candidateQuestion', () => {
  it('never exposes the answer key, and keeps the attempt’s option order', () => {
    const q = candidateQuestion(version(mcq()), ['c3', 'a1', 'b2']);
    expect(JSON.stringify(q)).not.toContain('isCorrect');
    expect('mcq' in q && q.mcq.options.map((o) => o.id)).toEqual([
      'c3',
      'a1',
      'b2',
    ]);
  });

  it('only shows sample test cases for coding questions', () => {
    const q = candidateQuestion(version(coding), null);
    const json = JSON.stringify(q);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('hidden');
    expect(json).not.toContain('weight');
    expect('coding' in q && q.coding.sampleTestCases).toEqual([
      { input: '1', expectedOutput: '1' },
    ]);
  });
});

describe('normaliseResponse', () => {
  it('accepts known options, de-duplicates, and treats an empty choice as cleared', () => {
    expect(normaliseResponse({ optionIds: ['a1', 'a1'] }, mcq())).toEqual({
      ok: true,
      value: { optionIds: ['a1'] },
    });
    expect(normaliseResponse({ optionIds: [] }, mcq())).toEqual({
      ok: true,
      value: null,
    });
    expect(normaliseResponse(null, mcq())).toEqual({ ok: true, value: null });
  });

  it('rejects unknown options and multiple picks on single-answer questions', () => {
    expect(normaliseResponse({ optionIds: ['zz'] }, mcq()).ok).toBe(false);
    expect(normaliseResponse({ optionIds: ['a1', 'b2'] }, mcq()).ok).toBe(
      false,
    );
    expect(normaliseResponse({ optionIds: ['a1', 'b2'] }, mcq(true))).toEqual({
      ok: true,
      value: { optionIds: ['a1', 'b2'] },
    });
    expect(normaliseResponse('a1', mcq()).ok).toBe(false);
  });

  it('keeps code per language and validates language and size', () => {
    const r = normaliseResponse(
      { language: 'python', sources: { python: 'x=1', javascript: 'let x' } },
      coding,
    );
    expect(r).toEqual({
      ok: true,
      value: {
        language: 'python',
        sources: { python: 'x=1', javascript: 'let x' },
      },
    });
    expect(
      normaliseResponse({ language: 'ruby', sources: {} }, coding).ok,
    ).toBe(false);
    expect(
      normaliseResponse(
        { language: 'python', sources: { python: 'x'.repeat(70_000) } },
        coding,
      ).ok,
    ).toBe(false);
    // Blank code in the chosen language = unanswered.
    expect(
      normaliseResponse(
        { language: 'python', sources: { python: '  ' } },
        coding,
      ),
    ).toEqual({ ok: true, value: null });
  });
});

describe('outputsMatch', () => {
  it('ignores line endings, trailing spaces and trailing blank lines', () => {
    expect(outputsMatch('1 2\r\n3  \n\n', '1 2\n3')).toBe(true);
    expect(outputsMatch('1 2', '1  2')).toBe(false);
    expect(outputsMatch(' 1', '1')).toBe(false);
  });
});

describe('shuffled', () => {
  it('returns a permutation without touching the input', () => {
    const xs = [1, 2, 3, 4];
    let n = 0;
    const out = shuffled(xs, () => [0.1, 0.9, 0.5][n++ % 3]);
    expect(out.sort()).toEqual([1, 2, 3, 4]);
    expect(xs).toEqual([1, 2, 3, 4]);
  });
});
