import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ExamStatus } from '../../../generated/prisma/enums.js';
import type {
  ExamInputDto,
  ListExamsQueryDto,
} from '../models/exam-input.dto.js';
import {
  effectiveDuration,
  examProblems,
  type QuestionFacts,
} from '../models/exam-rules.js';
import {
  examDetailInclude,
  itemMarks,
  questionCount,
  totalMarks,
  type ExamWithSections,
} from '../models/exam.model.js';

export type ExamErrorCode =
  | 'EXAM_NOT_FOUND'
  | 'INVALID_EXAM'
  | 'INVALID_TRANSITION'
  | 'EXAM_ARCHIVED'
  | 'EXAM_HAS_ATTEMPTS'
  | 'PUBLISHED_EXAM_ADMIN_ONLY';

const fail = (
  status: HttpStatus,
  code: ExamErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new AppError<ExamErrorCode>(status, code, message, details);

export type ExamAction = 'publish' | 'unpublish' | 'archive' | 'restore';

/** Exam lifecycle (FRD §4.6). Editors build drafts; admins publish (enforced by the routes). */
const TRANSITIONS: Record<ExamAction, { from: ExamStatus[]; to: ExamStatus }> =
  {
    publish: { from: ['draft'], to: 'published' },
    // Running attempts are unaffected: sessions carry their own copy of the exam.
    unpublish: { from: ['published'], to: 'draft' },
    archive: { from: ['draft', 'published'], to: 'archived' },
    restore: { from: ['archived'], to: 'draft' },
  };

const isAdmin = (u: AuthUser) => u.role === 'admin' || u.role === 'super_admin';

/** Exam & interview template builder (FRD §4.6, admin side). */
@Injectable()
export class ExamAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListExamsQueryDto) {
    const where: Prisma.ExamWhereInput = {
      deletedAt: null,
      ...(q.status && { status: q.status }),
      ...(q.kind && { kind: q.kind }),
      ...(q.search && {
        title: { contains: q.search, mode: 'insensitive' },
      }),
    };
    const [total, rows, counts] = await this.prisma.$transaction([
      this.prisma.exam.count({ where }),
      this.prisma.exam.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          sections: { select: { _count: { select: { items: true } } } },
          _count: { select: { sessions: true } },
          updatedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.exam.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        status: e.status,
        durationMinutes: e.durationMinutes,
        sectionTimed: e.sectionTimed,
        sectionCount: e.sections.length,
        questionCount: e.sections.reduce((a, s) => a + s._count.items, 0),
        attemptCount: e._count.sessions,
        publishedAt: e.publishedAt,
        updatedAt: e.updatedAt,
        updatedBy: e.updatedBy,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      statusCounts: Object.fromEntries(
        counts.map((c) => [c.status, c._count._all]),
      ) as Partial<Record<ExamStatus, number>>,
    };
  }

  async get(id: string) {
    return this.toDetail(await this.load(id));
  }

  /** `actor` is null for system writes (dev seed). */
  async create(actor: AuthUser | null, input: ExamInputDto) {
    const facts = await this.questionFacts(input);
    this.assertValid(input, facts, false);
    const exam = await this.prisma.exam.create({
      data: {
        ...this.examFields(input),
        createdById: actor?.id ?? null,
        updatedById: actor?.id ?? null,
        sections: { create: this.sectionRows(input, facts) },
      },
      select: { id: true },
    });
    return this.get(exam.id);
  }

  /**
   * Full replace of settings, sections and questions. Question versions are
   * re-pinned to each question's current live version. A published exam must
   * stay publishable, and only admins may change it.
   */
  async update(actor: AuthUser, id: string, input: ExamInputDto) {
    const exam = await this.load(id);
    if (exam.status === 'archived') {
      throw fail(
        HttpStatus.CONFLICT,
        'EXAM_ARCHIVED',
        'Restore this exam before editing it.',
      );
    }
    if (exam.status === 'published' && !isAdmin(actor)) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'PUBLISHED_EXAM_ADMIN_ONLY',
        'Only admins can change a published exam.',
      );
    }
    const facts = await this.questionFacts(input);
    this.assertValid(input, facts, exam.status === 'published');

    // Sections/items are structural children rewritten on every save, so
    // they're replaced outright rather than soft-deleted. Attempts don't
    // reference them (sessions copy what they need).
    await this.prisma.$transaction([
      this.prisma.examSection.deleteMany({ where: { examId: id } }),
      this.prisma.exam.update({
        where: { id },
        data: {
          ...this.examFields(input),
          updatedById: actor.id,
          sections: { create: this.sectionRows(input, facts) },
        },
      }),
    ]);
    return this.get(id);
  }

  async transition(actor: AuthUser | null, id: string, action: ExamAction) {
    const exam = await this.load(id);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(exam.status)) {
      throw fail(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `Can’t ${action} an exam that is ${exam.status}.`,
      );
    }
    if (action === 'publish') {
      const problems = this.problemsOf(exam, true);
      if (problems.length) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'INVALID_EXAM',
          'This exam isn’t ready to publish.',
          { errors: problems },
        );
      }
      // Pin the latest live versions at publish time.
      await this.prisma.$transaction(
        exam.sections.flatMap((s) =>
          s.items.map((i) =>
            this.prisma.examItem.update({
              where: { id: i.id },
              data: { questionVersionId: i.question.publishedVersion!.id },
            }),
          ),
        ),
      );
    }
    await this.prisma.exam.update({
      where: { id },
      data: {
        status: rule.to,
        updatedById: actor?.id ?? null,
        ...(action === 'publish' && {
          publishedAt: new Date(),
          publishedById: actor?.id ?? null,
        }),
      },
    });
    return this.get(id);
  }

  /** Drafts that nobody has attempted can be deleted (soft). */
  async remove(id: string) {
    const exam = await this.load(id);
    if (exam.status !== 'draft') {
      throw fail(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Only draft exams can be deleted. Archive it instead.',
      );
    }
    const attempts = await this.prisma.examSession.count({
      where: { examId: id },
    });
    if (attempts > 0) {
      throw fail(
        HttpStatus.CONFLICT,
        'EXAM_HAS_ATTEMPTS',
        'Candidates have attempted this exam. Archive it instead.',
      );
    }
    await this.prisma.exam.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── helpers ──

  private async load(id: string): Promise<ExamWithSections> {
    const exam = await this.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: examDetailInclude,
    });
    if (!exam)
      throw fail(HttpStatus.NOT_FOUND, 'EXAM_NOT_FOUND', 'Exam not found.');
    return exam;
  }

  private async questionFacts(input: ExamInputDto) {
    const ids = [...new Set(input.sections.flatMap((s) => s.questionIds))];
    const rows = ids.length
      ? await this.prisma.question.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { id: true, publishedVersionId: true },
        })
      : [];
    return new Map(rows.map((q) => [q.id, q.publishedVersionId]));
  }

  private assertValid(
    input: ExamInputDto,
    liveVersionByQuestion: Map<string, string | null>,
    publishing: boolean,
  ) {
    const facts = new Map<string, QuestionFacts>(
      [...liveVersionByQuestion].map(([id, v]) => [
        id,
        { exists: true, live: v !== null },
      ]),
    );
    const problems = examProblems(input, facts, { publishing });
    if (problems.length) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'INVALID_EXAM',
        'Please fix the highlighted problems.',
        { errors: problems },
      );
    }
  }

  private problemsOf(exam: ExamWithSections, publishing: boolean) {
    const facts = new Map<string, QuestionFacts>();
    for (const s of exam.sections)
      for (const i of s.items)
        facts.set(i.questionId, {
          exists: i.question.deletedAt === null,
          live: i.question.publishedVersion !== null,
        });
    return examProblems(
      {
        durationMinutes: exam.durationMinutes,
        sectionTimed: exam.sectionTimed,
        sections: exam.sections.map((s) => ({
          durationMinutes: s.durationMinutes,
          questionIds: s.items.map((i) => i.questionId),
        })),
      },
      facts,
      { publishing },
    );
  }

  private examFields(input: ExamInputDto) {
    return {
      title: input.title,
      kind: input.kind,
      description: input.description ?? null,
      instructions: input.instructions,
      durationMinutes: effectiveDuration(input),
      sectionTimed: input.sectionTimed,
      pauseOnDisconnect: input.pauseOnDisconnect,
      shuffleQuestions: input.shuffleQuestions,
      shuffleOptions: input.shuffleOptions,
      maxAttempts: input.maxAttempts ?? null,
      passPercent: input.passPercent ?? null,
    };
  }

  private sectionRows(
    input: ExamInputDto,
    liveVersionByQuestion: Map<string, string | null>,
  ): Prisma.ExamSectionCreateWithoutExamInput[] {
    return input.sections.map((s, position) => ({
      position,
      title: s.title,
      description: s.description ?? null,
      durationMinutes: input.sectionTimed ? (s.durationMinutes ?? null) : null,
      marksPerQuestion: s.marksPerQuestion ?? null,
      negativeMarkPercent: s.negativeMarkPercent,
      partialScoring: s.partialScoring,
      items: {
        create: s.questionIds.map((questionId, i) => ({
          position: i,
          questionId,
          questionVersionId: liveVersionByQuestion.get(questionId) ?? null,
        })),
      },
    }));
  }

  private toDetail(exam: ExamWithSections) {
    return {
      id: exam.id,
      title: exam.title,
      kind: exam.kind,
      status: exam.status,
      description: exam.description,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      sectionTimed: exam.sectionTimed,
      pauseOnDisconnect: exam.pauseOnDisconnect,
      shuffleQuestions: exam.shuffleQuestions,
      shuffleOptions: exam.shuffleOptions,
      maxAttempts: exam.maxAttempts,
      passPercent: exam.passPercent,
      publishedAt: exam.publishedAt,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      createdBy: exam.createdBy,
      updatedBy: exam.updatedBy,
      publishedBy: exam.publishedBy,
      questionCount: questionCount(exam),
      totalMarks: totalMarks(exam),
      sections: exam.sections.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        durationMinutes: s.durationMinutes,
        marksPerQuestion: s.marksPerQuestion,
        negativeMarkPercent: s.negativeMarkPercent,
        partialScoring: s.partialScoring,
        items: s.items.map((i) => ({
          questionId: i.questionId,
          title: i.question.title,
          type: i.question.type,
          difficulty: i.question.difficulty,
          questionStatus: i.question.status,
          topic: i.question.topic,
          marks: itemMarks(s, i),
          /** Version candidates of this exam get. */
          pinnedVersion: i.questionVersion?.versionNumber ?? null,
          /** Question's live version now; differs from pinned after a re-approval (save to update). */
          liveVersion: i.question.publishedVersion?.versionNumber ?? null,
        })),
      })),
      /** Why the exam can't be published yet (empty = ready). */
      publishProblems: this.problemsOf(exam, true),
    };
  }
}
