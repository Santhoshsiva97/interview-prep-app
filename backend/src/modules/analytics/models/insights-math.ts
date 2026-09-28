/**
 * Candidate insights (FRD §4.9): strengths and weaknesses from every graded
 * question a candidate has answered. Pure functions over integers; rates in
 * basis points (100 bp = 1%).
 */

export interface AnsweredItem {
  topicId: string;
  topicName: string;
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
  scoreCenti: number;
  outcome: 'correct' | 'partial' | 'incorrect' | 'unanswered';
  timeSpentMs: number;
}

export type Strength = 'strong' | 'developing' | 'weak' | 'not_enough_data';

export interface Mastery {
  questions: number;
  answered: number;
  correct: number;
  /** Share of the available marks earned; a negative mark counts as 0 for that question. */
  masteryBp: number;
  /** correct / answered */
  accuracyBp: number;
  avgTimeMs: number;
  strength: Strength;
}

/** Fewer questions than this in a topic and we don't label it. */
export const MIN_QUESTIONS = 3;

export function mastery(items: AnsweredItem[]): Mastery {
  const answered = items.filter((i) => i.outcome !== 'unanswered');
  const earned = items.reduce((a, i) => a + Math.max(0, i.scoreCenti), 0);
  const max = items.reduce((a, i) => a + i.marks * 100, 0);
  const correct = items.filter((i) => i.outcome === 'correct').length;
  const masteryBp = max ? Math.round((earned * 10_000) / max) : 0;
  return {
    questions: items.length,
    answered: answered.length,
    correct,
    masteryBp,
    accuracyBp: answered.length
      ? Math.round((correct * 10_000) / answered.length)
      : 0,
    avgTimeMs: answered.length
      ? Math.round(
          answered.reduce((a, i) => a + i.timeSpentMs, 0) / answered.length,
        )
      : 0,
    strength:
      items.length < MIN_QUESTIONS
        ? 'not_enough_data'
        : masteryBp >= 7500
          ? 'strong'
          : masteryBp >= 5000
            ? 'developing'
            : 'weak',
  };
}

/** Per topic, strongest first (stable by name). */
export function byTopic(items: AnsweredItem[]) {
  const groups = new Map<string, { name: string; items: AnsweredItem[] }>();
  for (const i of items) {
    const g = groups.get(i.topicId) ?? { name: i.topicName, items: [] };
    g.items.push(i);
    groups.set(i.topicId, g);
  }
  return [...groups]
    .map(([topicId, g]) => ({ topicId, name: g.name, ...mastery(g.items) }))
    .sort((a, b) => b.masteryBp - a.masteryBp || a.name.localeCompare(b.name));
}

export function byDifficulty(items: AnsweredItem[]) {
  return (['easy', 'medium', 'hard'] as const).map((difficulty) => ({
    difficulty,
    ...mastery(items.filter((i) => i.difficulty === difficulty)),
  }));
}
