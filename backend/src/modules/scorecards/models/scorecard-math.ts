/**
 * Scorecard arithmetic (FRD §4.8). Pure functions over integers: scores in
 * hundredths of a mark, percentages in basis points (100 bp = 1%).
 */

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'unanswered';

export interface GradedItem {
  sectionIndex: number;
  topicId: string;
  topicName: string;
  marks: number;
  scoreCenti: number | null;
  outcome: Outcome | null;
  timeSpentMs: number;
}

export interface SectionBreakdown {
  index: number;
  title: string;
  scoreCenti: number;
  maxScoreCenti: number;
  questionCount: number;
  correct: number;
  partial: number;
  incorrect: number;
  unanswered: number;
  timeSpentMs: number;
}

export interface TopicBreakdown {
  topicId: string;
  name: string;
  scoreCenti: number;
  maxScoreCenti: number;
  questionCount: number;
  correct: number;
}

/** score / max in basis points, floored at 0 (negative marking can push totals below zero). */
export function percentBp(scoreCenti: number, maxScoreCenti: number): number {
  if (maxScoreCenti <= 0) return 0;
  return Math.max(
    0,
    Math.min(10_000, Math.round((scoreCenti * 10_000) / maxScoreCenti)),
  );
}

/**
 * Percentile rank: the share of `cohort` scoring below `score`, with ties
 * counted half (so a lone candidate sits at the 50th percentile).
 */
export function percentileBp(score: number, cohort: number[]): number {
  if (!cohort.length) return 5000;
  const below = cohort.filter((s) => s < score).length;
  const equal = cohort.filter((s) => s === score).length;
  return Math.round(((below + equal / 2) * 10_000) / cohort.length);
}

export function sectionBreakdown(
  sections: { title: string }[],
  items: GradedItem[],
): SectionBreakdown[] {
  return sections.map((s, index) => {
    const mine = items.filter((i) => i.sectionIndex === index);
    const count = (o: Outcome) =>
      mine.filter((i) => (i.outcome ?? 'unanswered') === o).length;
    return {
      index,
      title: s.title,
      scoreCenti: sum(mine.map((i) => i.scoreCenti ?? 0)),
      maxScoreCenti: sum(mine.map((i) => i.marks * 100)),
      questionCount: mine.length,
      correct: count('correct'),
      partial: count('partial'),
      incorrect: count('incorrect'),
      unanswered: count('unanswered'),
      timeSpentMs: sum(mine.map((i) => i.timeSpentMs)),
    };
  });
}

/** Per topic, weakest first (lowest share of marks) so the scorecard leads with what to work on. */
export function topicBreakdown(items: GradedItem[]): TopicBreakdown[] {
  const byTopic = new Map<string, TopicBreakdown>();
  for (const i of items) {
    const t = byTopic.get(i.topicId) ?? {
      topicId: i.topicId,
      name: i.topicName,
      scoreCenti: 0,
      maxScoreCenti: 0,
      questionCount: 0,
      correct: 0,
    };
    t.scoreCenti += i.scoreCenti ?? 0;
    t.maxScoreCenti += i.marks * 100;
    t.questionCount += 1;
    if (i.outcome === 'correct') t.correct += 1;
    byTopic.set(i.topicId, t);
  }
  return [...byTopic.values()].sort(
    (a, b) =>
      percentBp(a.scoreCenti, a.maxScoreCenti) -
        percentBp(b.scoreCenti, b.maxScoreCenti) ||
      a.name.localeCompare(b.name),
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
