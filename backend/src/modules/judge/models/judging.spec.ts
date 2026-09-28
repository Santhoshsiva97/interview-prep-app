import {
  effectiveLimits,
  gradeCoding,
  gradeMcq,
  overallVerdict,
  verdictFor,
  type TestOutcome,
} from './judging.js';

const ok = (stdout: string): TestOutcome => ({
  status: 'ok',
  stdout,
  stderr: '',
  timeMs: 10,
  memoryKb: 1000,
});

describe('verdicts', () => {
  it('compares output for clean runs and maps failures', () => {
    expect(verdictFor(ok('3\r\n'), '3')).toBe('AC');
    expect(verdictFor(ok('4'), '3')).toBe('WA');
    expect(verdictFor({ ...ok(''), status: 'time_limit' }, '3')).toBe('TLE');
    expect(verdictFor({ ...ok(''), status: 'memory_limit' }, '3')).toBe('MLE');
    expect(verdictFor({ ...ok(''), status: 'runtime_error' }, '3')).toBe('RE');
    expect(verdictFor({ ...ok(''), status: 'compile_error' }, '3')).toBe('CE');
    expect(verdictFor({ ...ok(''), status: 'internal_error' }, '3')).toBe('IE');
  });

  it('overall: CE wins, else the first failure, else AC', () => {
    expect(overallVerdict(['AC', 'AC'])).toBe('AC');
    expect(overallVerdict(['AC', 'TLE', 'WA'])).toBe('TLE');
    expect(overallVerdict(['WA', 'CE'])).toBe('CE');
  });

  it('applies per-language allowances with caps', () => {
    expect(effectiveLimits('cpp', 1000, 256)).toEqual({
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    });
    expect(effectiveLimits('python', 2000, 256)).toEqual({
      timeLimitMs: 6000,
      memoryLimitMb: 256,
    });
    expect(effectiveLimits('java', 10_000, 512)).toEqual({
      timeLimitMs: 15_000,
      memoryLimitMb: 512,
    });
  });
});

describe('gradeMcq', () => {
  const single = [
    { id: 'a', isCorrect: true },
    { id: 'b', isCorrect: false },
  ];
  const multi = [
    { id: 'a', isCorrect: true },
    { id: 'b', isCorrect: true },
    { id: 'c', isCorrect: false },
  ];
  const item = { marks: 2, negativeMarkPercent: 25, partialScoring: true };

  it('full marks, negative marking and unanswered', () => {
    expect(gradeMcq(item, single, ['a'])).toEqual({
      scoreCenti: 200,
      outcome: 'correct',
    });
    expect(gradeMcq(item, single, ['b'])).toEqual({
      scoreCenti: -50,
      outcome: 'incorrect',
    });
    expect(gradeMcq(item, single, [])).toEqual({
      scoreCenti: 0,
      outcome: 'unanswered',
    });
    expect(gradeMcq(item, single, null)).toEqual({
      scoreCenti: 0,
      outcome: 'unanswered',
    });
    expect(
      gradeMcq({ ...item, negativeMarkPercent: 0 }, single, ['b']),
    ).toEqual({ scoreCenti: 0, outcome: 'incorrect' });
  });

  it('multi-answer: partial credit only for a clean subset, and only when allowed', () => {
    expect(gradeMcq(item, multi, ['a', 'b']).outcome).toBe('correct');
    expect(gradeMcq(item, multi, ['a'])).toEqual({
      scoreCenti: 100,
      outcome: 'partial',
    });
    expect(gradeMcq(item, multi, ['a', 'c'])).toEqual({
      scoreCenti: -50,
      outcome: 'incorrect',
    });
    expect(gradeMcq({ ...item, partialScoring: false }, multi, ['a'])).toEqual({
      scoreCenti: -50,
      outcome: 'incorrect',
    });
  });

  it('rounds to whole hundredths', () => {
    const one = { marks: 1, negativeMarkPercent: 33, partialScoring: true };
    expect(gradeMcq(one, single, ['b']).scoreCenti).toBe(-33);
    const three = [
      { id: 'a', isCorrect: true },
      { id: 'b', isCorrect: true },
      { id: 'c', isCorrect: true },
    ];
    expect(gradeMcq(one, three, ['a']).scoreCenti).toBe(33);
  });
});

describe('gradeCoding', () => {
  const tests = (...v: ('AC' | 'WA' | 'TLE' | 'CE')[]) =>
    v.map((verdict, i) => ({ verdict, weight: i + 1 }));

  it('partial scoring by passed weight', () => {
    expect(
      gradeCoding({ marks: 10, partialScoring: true }, tests('AC', 'AC', 'AC')),
    ).toEqual({
      scoreCenti: 1000,
      outcome: 'correct',
    });
    // weights 1,2,3: passed 1+3 of 6
    expect(
      gradeCoding({ marks: 10, partialScoring: true }, tests('AC', 'WA', 'AC')),
    ).toEqual({
      scoreCenti: 666,
      outcome: 'partial',
    });
  });

  it('all-or-nothing without partial scoring; never negative', () => {
    expect(
      gradeCoding({ marks: 10, partialScoring: false }, tests('AC', 'TLE'))
        .scoreCenti,
    ).toBe(0);
    expect(
      gradeCoding({ marks: 10, partialScoring: true }, tests('CE', 'CE')),
    ).toEqual({
      scoreCenti: 0,
      outcome: 'incorrect',
    });
    expect(gradeCoding({ marks: 10, partialScoring: true }, null).outcome).toBe(
      'unanswered',
    );
  });
});
