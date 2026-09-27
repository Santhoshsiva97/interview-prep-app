import {
  buildContent,
  contentFingerprint,
  contentProblems,
  stableStringify,
  type QuestionContent,
} from './question-content.js';

const mcq = (options: [string, boolean][], allowMultiple = false) => ({
  type: 'mcq' as const,
  mcq: {
    allowMultiple,
    options: options.map(([text, isCorrect]) => ({ text, isCorrect })),
  },
});
const test = (isSample: boolean) => ({
  input: '1',
  expectedOutput: '1',
  isSample,
  weight: 1,
});

describe('contentProblems', () => {
  it('accepts a valid single-answer MCQ', () => {
    expect(
      contentProblems(
        mcq([
          ['A', true],
          ['B', false],
        ]),
      ),
    ).toEqual([]);
  });

  it('needs a correct option, exactly one unless multiple answers are allowed', () => {
    expect(
      contentProblems(
        mcq([
          ['A', false],
          ['B', false],
        ]),
      )[0].message,
    ).toMatch(/at least one/);
    expect(
      contentProblems(
        mcq([
          ['A', true],
          ['B', true],
        ]),
      )[0].message,
    ).toMatch(/Only one/);
    expect(
      contentProblems(
        mcq(
          [
            ['A', true],
            ['B', true],
          ],
          true,
        ),
      ),
    ).toEqual([]);
  });

  it('rejects duplicate options (case/space-insensitive)', () => {
    expect(
      contentProblems(
        mcq([
          ['Yes', true],
          [' yes ', false],
        ]),
      )[0].message,
    ).toMatch(/different/);
  });

  it('coding needs sample and hidden tests and known languages', () => {
    const coding = (
      testCases: ReturnType<typeof test>[],
      starterCode = {},
    ) => ({
      type: 'coding' as const,
      coding: { testCases, starterCode },
    });
    expect(contentProblems(coding([test(true), test(false)]))).toEqual([]);
    expect(
      contentProblems(coding([test(false)])).map((p) => p.message),
    ).toContain('Add at least one sample test case');
    expect(
      contentProblems(coding([test(true)])).map((p) => p.message),
    ).toContain('Add at least one hidden test case');
    expect(
      contentProblems(coding([test(true), test(false)], { cobol: 'x' }))[0]
        .field,
    ).toBe('coding.starterCode.cobol');
  });

  it('rejects content that does not match the type', () => {
    expect(contentProblems({ type: 'mcq' })[0].field).toBe('mcq');
    expect(contentProblems({ type: 'coding' })[0].field).toBe('coding');
  });
});

describe('buildContent', () => {
  it('assigns unique option ids and keeps provided ones', () => {
    const c = buildContent({
      type: 'mcq',
      mcq: {
        allowMultiple: false,
        options: [
          { id: 'keep1', text: ' A ', isCorrect: true },
          { text: 'B', isCorrect: false },
          { id: 'keep1', text: 'C', isCorrect: false }, // duplicate id → replaced
        ],
      },
    }) as { mcq: { options: { id: string; text: string }[] } };
    const ids = c.mcq.options.map((o) => o.id);
    expect(ids[0]).toBe('keep1');
    expect(new Set(ids).size).toBe(3);
    expect(c.mcq.options[0].text).toBe('A');
  });

  it('drops empty starter code and unknown languages', () => {
    const c = buildContent({
      type: 'coding',
      coding: {
        timeLimitMs: 1000,
        memoryLimitMb: 64,
        starterCode: { python: 'x = 1', javascript: '  ', cobol: 'MOVE' },
        testCases: [test(true)],
      },
    }) as { coding: { starterCode: Record<string, string> } };
    expect(c.coding.starterCode).toEqual({ python: 'x = 1' });
  });
});

describe('contentFingerprint', () => {
  const base = {
    title: 'T',
    body: 'B',
    difficulty: 'easy',
    topicId: 't1',
    explanation: null,
    marks: 1,
  };

  it('ignores generated option ids', () => {
    const a = {
      mcq: {
        allowMultiple: false,
        options: [{ id: 'aaa', text: 'X', isCorrect: true }],
      },
    };
    const b = {
      mcq: {
        allowMultiple: false,
        options: [{ id: 'bbb', text: 'X', isCorrect: true }],
      },
    };
    expect(contentFingerprint({ ...base, content: a })).toBe(
      contentFingerprint({ ...base, content: b }),
    );
  });

  it('is independent of object key order (jsonb reorders keys)', () => {
    const a: QuestionContent = {
      coding: {
        timeLimitMs: 1,
        memoryLimitMb: 2,
        starterCode: {},
        testCases: [test(true)],
      },
    };
    const reordered = JSON.parse(
      '{"coding":{"testCases":[{"weight":1,"isSample":true,"expectedOutput":"1","input":"1"}],"starterCode":{},"memoryLimitMb":2,"timeLimitMs":1}}',
    ) as QuestionContent;
    expect(contentFingerprint({ ...base, content: a })).toBe(
      contentFingerprint({ ...base, content: reordered }),
    );
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(
      '{"a":[2,{"d":3}],"b":1}',
    );
  });
});
