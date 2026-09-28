import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ExamKind } from '../../../generated/prisma/enums.js';
import { itemMarks } from '../models/exam.model.js';

const catalogInclude = {
  sections: {
    orderBy: { position: 'asc' },
    include: {
      items: {
        select: {
          question: { select: { type: true } },
          questionVersion: { select: { marks: true } },
        },
      },
    },
  },
} satisfies Prisma.ExamInclude;

type CatalogExam = Prisma.ExamGetPayload<{ include: typeof catalogInclude }>;

/** Published exams and interviews as candidates see them (FRD §4.6). */
@Injectable()
export class ExamCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, kind?: ExamKind) {
    const exams = await this.prisma.exam.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        ...(kind && { kind }),
      },
      orderBy: { publishedAt: 'desc' },
      take: 200,
      include: catalogInclude,
    });
    const attempts = await this.attempts(
      user,
      exams.map((e) => e.id),
    );
    return exams.map((e) => ({
      ...this.summary(e),
      ...this.attemptInfo(e, attempts.get(e.id) ?? []),
    }));
  }

  /** Pre-test screen: instructions, structure and marking. */
  async get(user: AuthUser, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, status: 'published', deletedAt: null },
      include: catalogInclude,
    });
    if (!exam) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'EXAM_NOT_FOUND',
        'Exam not found.',
      );
    }
    const attempts = (await this.attempts(user, [id])).get(id) ?? [];
    return {
      ...this.summary(exam),
      ...this.attemptInfo(exam, attempts),
      instructions: exam.instructions,
      sectionTimed: exam.sectionTimed,
      pauseOnDisconnect: exam.pauseOnDisconnect,
      passPercent: exam.passPercent,
      answerReview: exam.answerReview,
      sections: exam.sections.map((s) => ({
        title: s.title,
        description: s.description,
        durationMinutes: exam.sectionTimed ? s.durationMinutes : null,
        questionCount: s.items.length,
        mcqCount: s.items.filter((i) => i.question.type === 'mcq').length,
        codingCount: s.items.filter((i) => i.question.type === 'coding').length,
        marks: s.items.reduce((a, i) => a + itemMarks(s, i), 0),
        negativeMarkPercent: s.negativeMarkPercent,
      })),
    };
  }

  private summary(e: CatalogExam) {
    const items = e.sections.flatMap((s) => s.items);
    return {
      id: e.id,
      title: e.title,
      kind: e.kind,
      description: e.description,
      durationMinutes: e.durationMinutes,
      sectionCount: e.sections.length,
      questionCount: items.length,
      totalMarks: e.sections.reduce(
        (a, s) => a + s.items.reduce((b, i) => b + itemMarks(s, i), 0),
        0,
      ),
      hasCoding: items.some((i) => i.question.type === 'coding'),
      maxAttempts: e.maxAttempts,
    };
  }

  private attemptInfo(
    e: CatalogExam,
    attempts: { id: string; status: string; submittedAt: Date | null }[],
  ) {
    const inProgress = attempts.find((a) => a.status === 'in_progress');
    return {
      attemptsUsed: attempts.length,
      inProgressSessionId: inProgress?.id ?? null,
      canStart:
        !!inProgress ||
        e.maxAttempts === null ||
        attempts.length < e.maxAttempts,
      lastSubmittedAt:
        attempts
          .map((a) => a.submittedAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    };
  }

  private async attempts(user: AuthUser, examIds: string[]) {
    const rows = examIds.length
      ? await this.prisma.examSession.findMany({
          where: { userId: user.id, examId: { in: examIds }, deletedAt: null },
          select: { id: true, examId: true, status: true, submittedAt: true },
        })
      : [];
    const byExam = new Map<string, typeof rows>();
    for (const r of rows)
      byExam.set(r.examId, [...(byExam.get(r.examId) ?? []), r]);
    return byExam;
  }
}
