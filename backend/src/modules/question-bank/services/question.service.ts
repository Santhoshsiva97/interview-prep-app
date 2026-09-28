import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { QuestionStatus } from '../../../generated/prisma/enums.js';
import {
  buildContent,
  contentFingerprint,
  contentProblems,
  type FieldProblem,
  type QuestionContent,
} from '../models/question-content.js';
import type { QuestionInputDto } from '../models/question-input.dto.js';
import {
  questionSummaryInclude,
  toQuestionSummary,
  type ListQuestionsQueryDto,
  type QuestionDetail,
  type QuestionSummary,
  type QuestionVersionView,
} from '../models/question.model.js';

export type QuestionErrorCode =
  | 'QUESTION_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'INVALID_QUESTION'
  | 'INVALID_TRANSITION'
  | 'TYPE_IMMUTABLE'
  | 'QUESTION_ARCHIVED';

const fail = (
  status: HttpStatus,
  code: QuestionErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new AppError<QuestionErrorCode>(status, code, message, details);

export type WorkflowAction =
  'submit' | 'withdraw' | 'approve' | 'reject' | 'archive' | 'restore';

/**
 * Approval workflow (FRD §4.11). Editors (and admins) submit/withdraw;
 * only admins approve, reject, archive and restore (enforced by the routes).
 */
const TRANSITIONS: Record<
  WorkflowAction,
  { from: QuestionStatus[]; to: QuestionStatus }
> = {
  submit: { from: ['draft', 'rejected'], to: 'pending_review' },
  withdraw: { from: ['pending_review'], to: 'draft' },
  approve: { from: ['pending_review'], to: 'published' },
  reject: { from: ['pending_review'], to: 'rejected' },
  archive: {
    from: ['draft', 'pending_review', 'published', 'rejected'],
    to: 'archived',
  },
  restore: { from: ['archived'], to: 'draft' },
};

export interface SaveResult {
  question: QuestionDetail;
  /** false when the submitted content was identical to the current version. */
  changed: boolean;
}

@Injectable()
export class QuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListQuestionsQueryDto) {
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      ...(q.type && { type: q.type }),
      ...(q.status && { status: q.status }),
      ...(q.difficulty && { difficulty: q.difficulty }),
      ...(q.topicId && { topicId: q.topicId }),
      ...(q.tagId && { tags: { some: { tagId: q.tagId } } }),
      ...(q.live === 'true' && { publishedVersionId: { not: null } }),
      ...(q.search && {
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          { externalId: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, rows, counts] = await this.prisma.$transaction([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        include: questionSummaryInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.question.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);
    return {
      items: rows.map(toQuestionSummary),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      /** For the status tabs (e.g. review-queue badge). */
      statusCounts: Object.fromEntries(
        counts.map((c) => [c.status, c._count._all]),
      ) as Partial<Record<QuestionStatus, number>>,
    };
  }

  async get(id: string): Promise<QuestionDetail> {
    const q = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...questionSummaryInclude,
        currentVersion: {
          include: { createdBy: { select: { id: true, name: true } } },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            changeNote: true,
            createdAt: true,
            createdBy: { select: { id: true, name: true } },
          },
        },
        submittedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (!q?.currentVersion) throw this.notFound();

    return {
      ...toQuestionSummary(q),
      version: this.toVersionView(q.currentVersion),
      history: q.versions.map((v) => ({
        versionNumber: v.versionNumber,
        changeNote: v.changeNote,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
        isCurrent: v.id === q.currentVersionId,
        isLive: v.id === q.publishedVersionId,
      })),
      submittedBy: q.submittedBy,
      reviewedBy: q.reviewedBy,
    };
  }

  async getVersion(
    id: string,
    versionNumber: number,
  ): Promise<QuestionVersionView> {
    const v = await this.prisma.questionVersion.findFirst({
      where: { questionId: id, versionNumber, question: { deletedAt: null } },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!v)
      throw fail(
        HttpStatus.NOT_FOUND,
        'VERSION_NOT_FOUND',
        'Version not found.',
      );
    return this.toVersionView(v);
  }

  /** Validation shared with bulk import. Returns problems instead of throwing. */
  async problems(input: QuestionInputDto): Promise<FieldProblem[]> {
    const problems = contentProblems(input);
    const topic = await this.prisma.topic.findFirst({
      where: { id: input.topicId, deletedAt: null },
      select: { id: true },
    });
    if (!topic) problems.push({ field: 'topicId', message: 'Topic not found' });
    if (input.tagIds.length) {
      const found = await this.prisma.tag.count({
        where: { id: { in: input.tagIds }, deletedAt: null },
      });
      if (found !== input.tagIds.length) {
        problems.push({
          field: 'tagIds',
          message: 'One or more tags don’t exist',
        });
      }
    }
    return problems;
  }

  async create(
    actor: AuthUser | null,
    input: QuestionInputDto,
    extras: { externalId?: string } = {},
  ): Promise<SaveResult> {
    await this.assertValid(input);
    const content = buildContent(input);

    const id = await this.prisma.$transaction(async (tx) => {
      const question = await tx.question.create({
        data: {
          type: input.type,
          title: input.title,
          topicId: input.topicId,
          difficulty: input.difficulty,
          externalId: extras.externalId,
          authorId: actor?.id,
          tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
        },
      });
      const version = await tx.questionVersion.create({
        data: this.versionData(question.id, 1, input, content, actor),
      });
      await tx.question.update({
        where: { id: question.id },
        data: { currentVersionId: version.id },
      });
      return question.id;
    });
    return { question: await this.get(id), changed: true };
  }

  /**
   * Every edit adds an immutable version and moves the question back to
   * `draft` for review. A published version stays live until the new one is
   * approved. Identical content creates no version (tags still update).
   */
  async update(
    actor: AuthUser | null,
    id: string,
    input: QuestionInputDto,
  ): Promise<SaveResult> {
    const q = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: { currentVersion: true, tags: { select: { tagId: true } } },
    });
    if (!q?.currentVersion) throw this.notFound();
    if (q.status === 'archived') {
      throw fail(
        HttpStatus.CONFLICT,
        'QUESTION_ARCHIVED',
        'Restore this question before editing it.',
      );
    }
    if (input.type !== q.type) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'TYPE_IMMUTABLE',
        'A question’s type can’t be changed.',
      );
    }
    await this.assertValid(input);

    const current = q.currentVersion;
    // Options sent without ids (e.g. re-imports) keep the id of the previous
    // version's option with the same text, so answer keys stay valid.
    const previous = current.content as unknown as QuestionContent;
    if (input.mcq && 'mcq' in previous) {
      const idByText = new Map(
        previous.mcq.options.map((o) => [o.text.trim().toLowerCase(), o.id]),
      );
      for (const o of input.mcq.options)
        o.id ??= idByText.get(o.text.trim().toLowerCase());
    }
    const content = buildContent(input);
    const contentChanged =
      contentFingerprint({
        ...input,
        explanation: input.explanation ?? null,
        content,
      }) !==
      contentFingerprint({
        ...current,
        content: current.content as unknown as QuestionContent,
      });

    const oldTags = new Set(q.tags.map((t) => t.tagId));
    const tagsChanged =
      oldTags.size !== input.tagIds.length ||
      input.tagIds.some((t) => !oldTags.has(t));
    if (!contentChanged && !tagsChanged)
      return { question: await this.get(id), changed: false };

    await this.prisma.$transaction(async (tx) => {
      if (tagsChanged) {
        await tx.questionTag.deleteMany({ where: { questionId: id } });
        await tx.questionTag.createMany({
          data: input.tagIds.map((tagId) => ({ questionId: id, tagId })),
        });
      }
      if (contentChanged) {
        const version = await tx.questionVersion.create({
          data: this.versionData(
            id,
            current.versionNumber + 1,
            input,
            content,
            actor,
          ),
        });
        await tx.question.update({
          where: { id },
          data: {
            currentVersionId: version.id,
            title: input.title,
            topicId: input.topicId,
            difficulty: input.difficulty,
            status: 'draft',
            submittedAt: null,
            submittedById: null,
          },
        });
      } else {
        await tx.question.update({
          where: { id },
          data: { updatedAt: new Date() },
        });
      }
    });
    return { question: await this.get(id), changed: true };
  }

  async transition(
    actor: AuthUser | null,
    id: string,
    action: WorkflowAction,
    note?: string,
  ): Promise<QuestionDetail> {
    const q = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
    });
    if (!q) throw this.notFound();
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(q.status)) {
      throw fail(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `Can’t ${action} a question that is ${q.status.replace('_', ' ')}.`,
        { status: q.status },
      );
    }

    const now = new Date();
    const data: Prisma.QuestionUncheckedUpdateInput = { status: rule.to };
    if (action === 'submit') {
      Object.assign(data, {
        submittedAt: now,
        submittedById: actor?.id ?? null,
      });
    } else if (action === 'approve' || action === 'reject') {
      Object.assign(data, {
        reviewedAt: now,
        reviewedById: actor?.id ?? null,
        reviewNote: action === 'reject' ? note : null,
      });
      if (action === 'approve') {
        Object.assign(data, {
          publishedVersionId: q.currentVersionId,
          publishedAt: now,
        });
      }
    } else if (action === 'archive') {
      data.publishedVersionId = null; // no longer served to candidates
    }
    await this.prisma.question.update({ where: { id }, data });
    return this.get(id);
  }

  private async assertValid(input: QuestionInputDto) {
    const problems = await this.problems(input);
    if (problems.length) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUESTION',
        problems[0].message,
        {
          errors: problems,
        },
      );
    }
  }

  private versionData(
    questionId: string,
    versionNumber: number,
    input: QuestionInputDto,
    content: QuestionContent,
    actor: AuthUser | null,
  ): Prisma.QuestionVersionUncheckedCreateInput {
    return {
      questionId,
      versionNumber,
      title: input.title,
      body: input.body,
      difficulty: input.difficulty,
      topicId: input.topicId,
      explanation: input.explanation ?? null,
      marks: input.marks,
      content: content as unknown as Prisma.InputJsonValue,
      changeNote: input.changeNote ?? (versionNumber === 1 ? 'Created' : null),
      createdById: actor?.id,
    };
  }

  private toVersionView(v: {
    versionNumber: number;
    title: string;
    body: string;
    difficulty: QuestionVersionView['difficulty'];
    topicId: string;
    explanation: string | null;
    marks: number;
    content: Prisma.JsonValue;
    changeNote: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
  }): QuestionVersionView {
    return { ...v, content: v.content as unknown as QuestionContent };
  }

  private notFound() {
    return fail(
      HttpStatus.NOT_FOUND,
      'QUESTION_NOT_FOUND',
      'Question not found.',
    );
  }
}

export type { QuestionSummary };
