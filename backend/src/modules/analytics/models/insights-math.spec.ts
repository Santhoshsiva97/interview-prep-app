import {
  byDifficulty,
  byTopic,
  mastery,
  type AnsweredItem,
} from './insights-math.js';

const item = (o: Partial<AnsweredItem>): AnsweredItem => ({
  topicId: 'arr',
  topicName: 'Arrays',
  difficulty: 'easy',
  marks: 1,
  scoreCenti: 100,
  outcome: 'correct',
  timeSpentMs: 10_000,
  ...o,
});

describe('mastery', () => {
  it('marks earned (negatives count as 0), accuracy over answered, time over answered', () => {
    const m = mastery([
      item({}),
      item({ scoreCenti: -25, outcome: 'incorrect', timeSpentMs: 30_000 }),
      item({
        marks: 2,
        scoreCenti: 100,
        outcome: 'partial',
        timeSpentMs: 20_000,
      }),
      item({ scoreCenti: 0, outcome: 'unanswered', timeSpentMs: 0 }),
    ]);
    // earned 100 + 0 + 100 + 0 of 500
    expect(m).toEqual({
      questions: 4,
      answered: 3,
      correct: 1,
      masteryBp: 4000,
      accuracyBp: 3333,
      avgTimeMs: 20_000,
      strength: 'weak',
    });
  });

  it('labels strength only with enough questions', () => {
    expect(mastery([item({}), item({})]).strength).toBe('not_enough_data');
    expect(mastery([item({}), item({}), item({})]).strength).toBe('strong');
    expect(
      mastery([
        item({}),
        item({}),
        item({ scoreCenti: 0, outcome: 'incorrect' }),
      ]).strength,
    ).toBe('developing');
    expect(mastery([]).masteryBp).toBe(0);
  });
});

describe('groupings', () => {
  const items = [
    item({}),
    item({
      topicId: 'dp',
      topicName: 'DP',
      difficulty: 'hard',
      scoreCenti: 0,
      outcome: 'incorrect',
    }),
    item({ topicId: 'dp', topicName: 'DP', difficulty: 'medium' }),
  ];

  it('by topic, strongest first', () => {
    expect(byTopic(items).map((t) => [t.name, t.masteryBp])).toEqual([
      ['Arrays', 10_000],
      ['DP', 5000],
    ]);
  });

  it('by difficulty, always all three levels', () => {
    expect(
      byDifficulty(items).map((d) => [d.difficulty, d.questions, d.masteryBp]),
    ).toEqual([
      ['easy', 1, 10_000],
      ['medium', 1, 10_000],
      ['hard', 1, 0],
    ]);
  });
});
