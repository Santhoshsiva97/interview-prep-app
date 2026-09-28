import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type {
  CodingResponse,
  McqResponse,
  SessionSnapshot,
} from '../../exams/models/session-content.js';
import { ExamSessionLifecycle } from '../../exams/services/exam-session-lifecycle.js';
import type { QuestionContent } from '../../question-bank/models/question-content.js';
import {
  percentBp,
  percentileBp,
  sectionBreakdown,
  topicBreakdown,
  type GradedItem,
  type SectionBreakdown,
  type TopicBreakdown,
} from '../models/scorecard-math.js';

type ScorecardErrorCode = 'SCORECARD_NOT_FOUND';

const notFound = () =>
  new AppError<ScorecardErrorCode>(
    HttpStatus.NOT_FOUND,
    'SCORECARD_NOT_FOUND',
    'Attempt not found.',
  );

const marks = (centi: number) => centi / 100;
const pct = (bp: number) => bp / 100;
const isStaff = (u: AuthUser) =>
  u.role === 'admin' || u.role === 'support' || u.role === 'super_admin';

const sessionInclude = {
  items: {
    orderBy: [{ sectionIndex: 'asc' }, { position: 'asc' }],
    include: {
      questionVersion: {
        select: {
          title: true,
          body: true,
          explanation: true,
          content: true,
          topic: { select: { id: true, name: true } },
        },
      },
      codeSubmissions: {
        where: { kind: 'grade' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
  scorecard: true,
} satisfies Prisma.ExamSessionInclude;

type SessionWithItems = Prisma.ExamSessionGetPayload<{
  include: typeof sessionInclude;
}>;

interface StoredTest {
  isSample: boolean;
  verdict: string;
  stdout: string;
  input?: string;
  expectedOutput?: string;
  timeMs: number | null;
}

/**
 * Scorecards (FRD §4.8): built once an attempt is fully graded (the judge's
 * `graded` event), with section/topic breakdowns, time analysis, a
 * percentile against other candidates' first attempts, answer review (per
 * the exam's policy) and the candidate's earlier attempts at the same exam.
 */
@Injectable()
export class ScorecardService implements OnModuleInit {
  private readonly logger = new Logger(ScorecardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ExamSessionLifecycle,
  ) {}

  onModuleInit() {
    this.lifecycle.subscribe(async (e) => {
      if (e.type === 'graded') await this.build(e.sessionId);
    });
  }

  /** (Re)builds and persists the scorecard. Null if the attempt isn't fully graded. */
  async build(sessionId: string) {
    const s = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: sessionInclude,
    });
    if (!s || s.gradingStatus !== 'graded' || s.scoreCenti === null)
      return null;
    const snapshot = s.snapshot as unknown as SessionSnapshot;
    const items = this.gradedItems(s);
    const maxScoreCenti = s.totalMarks * 100;
    const percent = percentBp(s.scoreCenti, maxScoreCenti);
    const { percentile, cohortSize } = await this.percentile(s);
    const data = {
      examId: s.examId,
      userId: s.userId,
      attemptNumber: s.attemptNumber,
      scoreCenti: s.scoreCenti,
      maxScoreCenti,
      percentBp: percent,
      passed:
        snapshot.settings.passPercent === null
          ? null
          : percent >= snapshot.settings.passPercent * 100,
      percentileBp: percentile,
      cohortSize,
      percentileUpdatedAt: new Date(),
      sections: sectionBreakdown(
        snapshot.sections,
        items,
      ) as unknown as Prisma.InputJsonValue,
      topics: topicBreakdown(items) as unknown as Prisma.InputJsonValue,
      timeSpentMs: items.reduce((a, i) => a + i.timeSpentMs, 0),
      durationMs: Math.max(
        0,
        (s.submittedAt ?? s.updatedAt).getTime() - s.startedAt.getTime(),
      ),
      submittedAt: s.submittedAt ?? s.updatedAt,
    };
    return this.prisma.scorecard.upsert({
      where: { sessionId },
      create: { sessionId, ...data },
      update: data,
    });
  }

  /** History & Scorecards list: every closed attempt, newest first. */
  async listMine(user: AuthUser) {
    // Graded attempts whose scorecard is missing (hook missed, or graded
    // before scorecards existed) are built on the way.
    const missing = await this.prisma.examSession.findMany({
      where: {
        userId: user.id,
        gradingStatus: 'graded',
        scorecard: null,
        deletedAt: null,
      },
      select: { id: true },
      take: 20,
    });
    for (const m of missing) {
      await this.build(m.id).catch((err: unknown) =>
        this.logger.warn(`Scorecard build failed for ${m.id}: ${String(err)}`),
      );
    }
    const rows = await this.prisma.examSession.findMany({
      where: { userId: user.id, status: 'submitted', deletedAt: null },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        examId: true,
        attemptNumber: true,
        submittedAt: true,
        submitReason: true,
        gradingStatus: true,
        snapshot: true,
        _count: { select: { items: true } },
        scorecard: {
          select: {
            scoreCenti: true,
            maxScoreCenti: true,
            percentBp: true,
            percentileBp: true,
            cohortSize: true,
            passed: true,
          },
        },
      },
    });
    return rows.map((r) => {
      const settings = (r.snapshot as unknown as SessionSnapshot).settings;
      return {
        sessionId: r.id,
        examId: r.examId,
        title: settings.title,
        kind: settings.kind,
        attemptNumber: r.attemptNumber,
        submittedAt: r.submittedAt,
        submitReason: r.submitReason,
        gradingStatus: r.gradingStatus,
        questionCount: r._count.items,
        result: r.scorecard && this.summary(r.scorecard),
      };
    });
  }

  /** Dashboard "Recent activity". */
  async recent(userId: string, take = 5) {
    const rows = await this.listMine({ id: userId, role: 'candidate' });
    return rows.slice(0, take);
  }

  /** The full scorecard for one attempt (owner, or admin/support staff). */
  async get(user: AuthUser, sessionId: string) {
    let s = await this.prisma.examSession.findFirst({
      where: { id: sessionId, deletedAt: null, status: 'submitted' },
      include: sessionInclude,
    });
    if (!s || (s.userId !== user.id && !isStaff(user))) throw notFound();

    // Built lazily if the `graded` hook was missed; percentile refreshed as the cohort grows.
    if (
      s.gradingStatus === 'graded' &&
      (!s.scorecard || (await this.cohortChanged(s)))
    ) {
      try {
        await this.build(s.id);
        s = (await this.prisma.examSession.findUnique({
          where: { id: sessionId },
          include: sessionInclude,
        }))!;
      } catch (err) {
        this.logger.warn(
          `Scorecard build failed for ${sessionId}: ${String(err)}`,
        );
      }
    }

    const snapshot = s.snapshot as unknown as SessionSnapshot;
    const policy = snapshot.settings.answerReview ?? 'full';
    const card = s.scorecard;
    const graded = s.gradingStatus === 'graded' && card !== null;
    const history = await this.prisma.scorecard.findMany({
      where: { userId: s.userId, examId: s.examId, deletedAt: null },
      orderBy: { attemptNumber: 'asc' },
      select: {
        sessionId: true,
        attemptNumber: true,
        submittedAt: true,
        scoreCenti: true,
        percentBp: true,
      },
    });

    let number = 0;
    return {
      sessionId: s.id,
      exam: {
        id: s.examId,
        title: snapshot.settings.title,
        kind: snapshot.settings.kind,
        passPercent: snapshot.settings.passPercent,
        answerReview: policy,
      },
      attemptNumber: s.attemptNumber,
      startedAt: s.startedAt,
      submittedAt: s.submittedAt,
      submitReason: s.submitReason,
      gradingStatus: s.gradingStatus,
      gradingError: isStaff(user) ? s.gradingError : null,
      scorecard: card && {
        ...this.summary(card),
        timeSpentMs: card.timeSpentMs,
        durationMs: card.durationMs,
        sections: (card.sections as unknown as SectionBreakdown[]).map((x) => ({
          ...x,
          score: marks(x.scoreCenti),
          maxScore: marks(x.maxScoreCenti),
          percent: pct(percentBp(x.scoreCenti, x.maxScoreCenti)),
        })),
        topics: (card.topics as unknown as TopicBreakdown[]).map((x) => ({
          ...x,
          score: marks(x.scoreCenti),
          maxScore: marks(x.maxScoreCenti),
          percent: pct(percentBp(x.scoreCenti, x.maxScoreCenti)),
        })),
      },
      /** Every question in order: time analysis always, answer review per the exam's policy. */
      questions: s.items.map((i) => ({
        id: i.id,
        number: ++number,
        sectionIndex: i.sectionIndex,
        sectionTitle: snapshot.sections[i.sectionIndex]?.title ?? '',
        type: i.type,
        title: i.questionVersion.title,
        topic: i.questionVersion.topic.name,
        marks: i.marks,
        score: graded && i.scoreCenti !== null ? marks(i.scoreCenti) : null,
        outcome: graded ? (i.outcome ?? 'unanswered') : null,
        timeSpentMs: i.timeSpentMs,
        review:
          graded && policy !== 'none'
            ? this.review(i, policy === 'full')
            : null,
      })),
      history: history.map((h) => ({
        sessionId: h.sessionId,
        attemptNumber: h.attemptNumber,
        submittedAt: h.submittedAt,
        score: marks(h.scoreCenti),
        percent: pct(h.percentBp),
        current: h.sessionId === s.id,
      })),
    };
  }

  // ── internals ──

  private summary(c: {
    scoreCenti: number;
    maxScoreCenti: number;
    percentBp: number;
    percentileBp: number;
    cohortSize: number;
    passed: boolean | null;
  }) {
    return {
      score: marks(c.scoreCenti),
      maxScore: marks(c.maxScoreCenti),
      percent: pct(c.percentBp),
      percentile: pct(c.percentileBp),
      cohortSize: c.cohortSize,
      passed: c.passed,
    };
  }

  private gradedItems(s: SessionWithItems): GradedItem[] {
    return s.items.map((i) => ({
      sectionIndex: i.sectionIndex,
      topicId: i.questionVersion.topic.id,
      topicName: i.questionVersion.topic.name,
      marks: i.marks,
      scoreCenti: i.scoreCenti,
      outcome: i.outcome,
      timeSpentMs: i.timeSpentMs,
    }));
  }

  /**
   * Cohort = every candidate's first graded attempt at this exam (so retakes
   * don't skew it), plus this attempt if it's a retake.
   */
  private async percentile(s: {
    id: string;
    examId: string;
    scoreCenti: number | null;
  }) {
    const others = await this.prisma.scorecard.findMany({
      where: {
        examId: s.examId,
        attemptNumber: 1,
        deletedAt: null,
        sessionId: { not: s.id },
      },
      select: { scoreCenti: true },
    });
    const cohort = [...others.map((o) => o.scoreCenti), s.scoreCenti ?? 0];
    return {
      percentile: percentileBp(s.scoreCenti ?? 0, cohort),
      cohortSize: cohort.length,
    };
  }

  private async cohortChanged(s: SessionWithItems) {
    if (!s.scorecard) return true;
    const others = await this.prisma.scorecard.count({
      where: {
        examId: s.examId,
        attemptNumber: 1,
        deletedAt: null,
        sessionId: { not: s.id },
      },
    });
    return others + 1 !== s.scorecard.cohortSize;
  }

  /**
   * Answer review for one question. `full`: the answer key, explanation and
   * sample-test results too; otherwise only what the candidate answered.
   * Hidden tests are only ever summarised (passed / total), never shown.
   */
  private review(i: SessionWithItems['items'][number], full: boolean) {
    const content = i.questionVersion.content as unknown as QuestionContent;
    if ('mcq' in content) {
      const chosen = new Set(
        (i.response as McqResponse | null)?.optionIds ?? [],
      );
      const order =
        (i.optionOrder as string[] | null) ??
        content.mcq.options.map((o) => o.id);
      const byId = new Map(content.mcq.options.map((o) => [o.id, o]));
      return {
        body: i.questionVersion.body,
        explanation: full ? i.questionVersion.explanation : null,
        options: order
          .map((id) => byId.get(id))
          .filter((o) => o !== undefined)
          .map((o) => ({
            id: o.id,
            text: o.text,
            chosen: chosen.has(o.id),
            isCorrect: full ? o.isCorrect : null,
          })),
        code: null,
      };
    }
    const r = i.response as CodingResponse | null;
    const sub = i.codeSubmissions[0];
    const tests = (sub?.results ?? []) as unknown as StoredTest[];
    const hidden = tests.filter((t) => !t.isSample);
    return {
      body: i.questionVersion.body,
      explanation: full ? i.questionVersion.explanation : null,
      options: null,
      code: {
        language: r?.language ?? null,
        source: r ? (r.sources[r.language] ?? '') : null,
        verdict: sub?.verdict ?? null,
        compileOutput: full ? (sub?.compileOutput ?? null) : null,
        passedCount: sub?.passedCount ?? null,
        totalCount: sub?.totalCount ?? null,
        hiddenPassed: hidden.filter((t) => t.verdict === 'AC').length,
        hiddenTotal: hidden.length,
        samples: full
          ? tests
              .filter((t) => t.isSample)
              .map((t) => ({
                input: t.input ?? '',
                expectedOutput: t.expectedOutput ?? '',
                output: t.stdout,
                verdict: t.verdict,
                timeMs: t.timeMs,
              }))
          : [],
      },
    };
  }
}
