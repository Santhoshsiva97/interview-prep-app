import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  byDifficulty,
  byTopic,
  mastery,
  type AnsweredItem,
  type Mastery,
  type Strength,
} from '../models/insights-math.js';

const pct = (bp: number) => bp / 100;

/** Mastery as the API returns it: percentages 0–100. */
export interface MasteryView {
  questions: number;
  answered: number;
  correct: number;
  mastery: number;
  accuracy: number;
  avgTimeMs: number;
  strength: Strength;
}

export interface TopicInsight extends MasteryView {
  topicId: string;
  name: string;
}

export interface Recommendation {
  examId: string;
  title: string;
  kind: 'mock_exam' | 'virtual_interview';
  durationMinutes: number;
  questionCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Which of the candidate's weak topics it practises. */
  weakTopics: string[];
}

const view = (m: Mastery): MasteryView => ({
  questions: m.questions,
  answered: m.answered,
  correct: m.correct,
  mastery: pct(m.masteryBp),
  accuracy: pct(m.accuracyBp),
  avgTimeMs: m.avgTimeMs,
  strength: m.strength,
});

/**
 * Candidate insights (FRD §4.9): strengths and weaknesses by topic and
 * difficulty from the candidate's whole graded history, the score trend,
 * and tests to take next (aimed at the weakest topics).
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string) {
    const answered = await this.answeredItems(userId);
    const scorecards = await this.prisma.scorecard.findMany({
      where: { userId, deletedAt: null },
      orderBy: { submittedAt: 'asc' },
      select: {
        sessionId: true,
        attemptNumber: true,
        submittedAt: true,
        percentBp: true,
        timeSpentMs: true,
        exam: { select: { id: true, title: true } },
      },
    });

    const topics = this.topics(answered);
    const overall = mastery(answered);
    const percents = scorecards.map((s) => s.percentBp);

    return {
      totals: {
        testsCompleted: scorecards.length,
        questionsAnswered: overall.answered,
        averagePercent: percents.length
          ? pct(
              Math.round(percents.reduce((a, b) => a + b, 0) / percents.length),
            )
          : null,
        bestPercent: percents.length ? pct(Math.max(...percents)) : null,
        // Time on questions, not wall time: a paused attempt can stay open for hours.
        timeSpentMs: scorecards.reduce((a, s) => a + s.timeSpentMs, 0),
        overall: view(overall),
      },
      topics,
      difficulty: byDifficulty(answered).map((d) => ({
        difficulty: d.difficulty,
        ...view(d),
      })),
      trend: scorecards.map((s) => ({
        sessionId: s.sessionId,
        examId: s.exam.id,
        title: s.exam.title,
        attemptNumber: s.attemptNumber,
        submittedAt: s.submittedAt,
        percent: pct(s.percentBp),
      })),
      recommendations: await this.recommend(userId, topics),
    };
  }

  private topics(answered: AnsweredItem[]): TopicInsight[] {
    return byTopic(answered).map((t) => ({
      topicId: t.topicId,
      name: t.name,
      ...view(t),
    }));
  }

  /** Every graded question in the candidate's history. */
  private async answeredItems(userId: string): Promise<AnsweredItem[]> {
    const items = await this.prisma.examSessionItem.findMany({
      where: {
        session: { userId, gradingStatus: 'graded', deletedAt: null },
        outcome: { not: null },
      },
      select: {
        marks: true,
        scoreCenti: true,
        outcome: true,
        timeSpentMs: true,
        questionVersion: {
          select: {
            difficulty: true,
            topic: { select: { id: true, name: true } },
          },
        },
      },
    });
    return items.map((i) => ({
      topicId: i.questionVersion.topic.id,
      topicName: i.questionVersion.topic.name,
      difficulty: i.questionVersion.difficulty,
      marks: i.marks,
      scoreCenti: i.scoreCenti ?? 0,
      outcome: i.outcome!,
      timeSpentMs: i.timeSpentMs,
    }));
  }

  /**
   * Up to 3 published tests the candidate hasn't taken, ranked by how many
   * of their questions cover the candidate's weakest topics, then newest
   * first (so with no history, or nothing weak, it's simply the newest).
   */
  async recommend(
    userId: string,
    known?: TopicInsight[],
  ): Promise<Recommendation[]> {
    const topics = known ?? this.topics(await this.answeredItems(userId));
    const weak = [...topics]
      .filter((t) => t.strength === 'weak' || t.strength === 'developing')
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 3);
    const weakIds = new Set(weak.map((t) => t.topicId));

    const exams = await this.prisma.exam.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        sessions: { none: { userId } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        kind: true,
        durationMinutes: true,
        sections: {
          select: {
            items: {
              select: {
                question: {
                  select: {
                    difficulty: true,
                    topic: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return (
      exams
        .map((e, order) => {
          const qs = e.sections.flatMap((s) => s.items.map((i) => i.question));
          const matching = qs.filter((q) => weakIds.has(q.topic.id));
          const counts = new Map<string, number>();
          for (const q of qs)
            counts.set(q.difficulty, (counts.get(q.difficulty) ?? 0) + 1);
          const difficulty =
            [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'medium';
          return {
            examId: e.id,
            title: e.title,
            kind: e.kind,
            durationMinutes: e.durationMinutes,
            questionCount: qs.length,
            difficulty: difficulty as 'easy' | 'medium' | 'hard',
            /** Which of the candidate's weak topics it practises. */
            weakTopics: [...new Set(matching.map((q) => q.topic.name))],
            score: matching.length,
            order,
          };
        })
        // Tests covering weak topics first, then the newest (also the cold start).
        .filter((r) => r.questionCount > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, 3)
        .map(({ score: _score, order: _order, ...r }) => r)
    );
  }
}
