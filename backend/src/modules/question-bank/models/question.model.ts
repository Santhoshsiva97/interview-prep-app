import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  Difficulty,
  QuestionStatus,
  QuestionType,
} from '../../../generated/prisma/enums.js';
import type { QuestionContent } from './question-content.js';

/** GET /admin/questions */
export class ListQuestionsQueryDto {
  /** Title or external id (case-insensitive substring). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(QuestionType))
  type?: QuestionType;

  @IsOptional()
  @IsIn(Object.values(QuestionStatus))
  status?: QuestionStatus;

  @IsOptional()
  @IsIn(Object.values(Difficulty))
  difficulty?: Difficulty;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export const questionSummaryInclude = {
  topic: { select: { id: true, name: true, slug: true } },
  tags: {
    include: {
      tag: { select: { id: true, name: true, slug: true, kind: true } },
    },
  },
  currentVersion: { select: { versionNumber: true } },
  publishedVersion: { select: { versionNumber: true } },
  author: { select: { id: true, name: true } },
} satisfies Prisma.QuestionInclude;

type SummaryRow = Prisma.QuestionGetPayload<{
  include: typeof questionSummaryInclude;
}>;

export const toQuestionSummary = (q: SummaryRow) => ({
  id: q.id,
  type: q.type,
  status: q.status,
  title: q.title,
  difficulty: q.difficulty,
  externalId: q.externalId,
  topic: q.topic,
  tags: q.tags.map((t) => t.tag),
  currentVersion: q.currentVersion?.versionNumber ?? null,
  /** Version candidates currently see, or null if nothing is live. */
  liveVersion: q.publishedVersion?.versionNumber ?? null,
  author: q.author,
  reviewNote: q.reviewNote,
  submittedAt: q.submittedAt,
  reviewedAt: q.reviewedAt,
  publishedAt: q.publishedAt,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

export type QuestionSummary = ReturnType<typeof toQuestionSummary>;

export interface QuestionVersionView {
  versionNumber: number;
  title: string;
  body: string;
  difficulty: Difficulty;
  topicId: string;
  explanation: string | null;
  marks: number;
  content: QuestionContent;
  changeNote: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
}

export interface QuestionDetail extends QuestionSummary {
  version: QuestionVersionView;
  history: {
    versionNumber: number;
    changeNote: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
    isCurrent: boolean;
    isLive: boolean;
  }[];
  submittedBy: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
}
