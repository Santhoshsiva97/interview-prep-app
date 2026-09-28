import {
  percentBp,
  percentileBp,
  sectionBreakdown,
  topicBreakdown,
  type GradedItem,
} from './scorecard-math.js';

const item = (o: Partial<GradedItem>): GradedItem => ({
  sectionIndex: 0,
  topicId: 't1',
  topicName: 'Arrays',
  marks: 2,
  scoreCenti: 200,
  outcome: 'correct',
  timeSpentMs: 1000,
  ...o,
});

describe('percentBp', () => {
  it('rounds to basis points and floors negative totals at 0%', () => {
    expect(percentBp(675, 2900)).toBe(2328);
    expect(percentBp(2900, 2900)).toBe(10_000);
    expect(percentBp(-50, 2900)).toBe(0);
    expect(percentBp(100, 0)).toBe(0);
  });
});

describe('percentileBp', () => {
  it('counts the share below, ties half', () => {
    expect(percentileBp(50, [10, 20, 50, 90])).toBe(6250); // 2 below + ½ tie of 4
    expect(percentileBp(100, [10, 20, 30])).toBe(10_000);
    expect(percentileBp(5, [10, 20])).toBe(0);
    expect(percentileBp(10, [10])).toBe(5000); // alone
    expect(percentileBp(10, [])).toBe(5000);
  });
});

describe('breakdowns', () => {
  const items = [
    item({}),
    item({ scoreCenti: -50, outcome: 'incorrect', timeSpentMs: 3000 }),
    item({
      sectionIndex: 1,
      topicId: 't2',
      topicName: 'DP',
      marks: 10,
      scoreCenti: 500,
      outcome: 'partial',
    }),
    item({
      sectionIndex: 1,
      topicId: 't2',
      topicName: 'DP',
      marks: 10,
      scoreCenti: null,
      outcome: null,
      timeSpentMs: 0,
    }),
  ];

  it('per section: score, max, outcome counts and time', () => {
    expect(
      sectionBreakdown([{ title: 'MCQ' }, { title: 'Code' }], items),
    ).toEqual([
      {
        index: 0,
        title: 'MCQ',
        scoreCenti: 150,
        maxScoreCenti: 400,
        questionCount: 2,
        correct: 1,
        partial: 0,
        incorrect: 1,
        unanswered: 0,
        timeSpentMs: 4000,
      },
      {
        index: 1,
        title: 'Code',
        scoreCenti: 500,
        maxScoreCenti: 2000,
        questionCount: 2,
        correct: 0,
        partial: 1,
        incorrect: 0,
        unanswered: 1,
        timeSpentMs: 1000,
      },
    ]);
  });

  it('per topic, weakest first', () => {
    expect(
      topicBreakdown(items).map((t) => [t.name, t.scoreCenti, t.maxScoreCenti]),
    ).toEqual([
      ['DP', 500, 2000],
      ['Arrays', 150, 400],
    ]);
  });
});
