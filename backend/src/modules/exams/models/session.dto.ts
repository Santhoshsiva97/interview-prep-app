import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ExamKind } from '../../../generated/prisma/enums.js';
import { CODING_LANGUAGES } from '../../question-bank/models/question-content.js';
import { SOURCE_MAX_BYTES } from './session-content.js';

/** POST /exams/:id/sessions */
export class StartSessionDto {
  /** The candidate ticked "I have read the instructions and agree". */
  @Equals(true, { message: 'You need to accept the instructions to start' })
  consent: boolean;
}

export class AnswerDto {
  @IsUUID()
  itemId: string;

  /**
   * MCQ `{ optionIds }`, coding `{ language, sources }`, `null` to clear, or
   * omitted to leave the answer unchanged (e.g. only toggling review).
   * Shape is checked against the question in the service.
   */
  @IsOptional()
  response?: unknown;

  @IsOptional()
  @IsBoolean()
  markedForReview?: boolean;

  @IsOptional()
  @IsBoolean()
  visited?: boolean;

  /** Time spent on this question since the last save (client-measured). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 3600 * 1000)
  timeSpentMs?: number;
}

/** PATCH /exam-sessions/:id (autosave) and the body of submit. */
export class SaveSessionDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  @ArrayMaxSize(500)
  answers: AnswerDto[] = [];
}

export class SubmitSessionDto extends SaveSessionDto {
  /** The client's timer reached zero (vs. the candidate clicking Submit). */
  @IsOptional()
  @IsBoolean()
  auto?: boolean;
}

/** POST /exam-sessions/:id/run */
export class RunCodeDto {
  @IsUUID()
  itemId: string;

  @IsIn(CODING_LANGUAGES)
  language: (typeof CODING_LANGUAGES)[number];

  @IsString()
  @MaxLength(SOURCE_MAX_BYTES)
  code: string;
}

/** GET /exams */
export class CatalogQueryDto {
  @IsOptional()
  @IsIn(Object.values(ExamKind))
  kind?: ExamKind;
}
