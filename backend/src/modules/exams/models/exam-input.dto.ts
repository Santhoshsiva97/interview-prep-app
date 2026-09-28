import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ExamKind, ExamStatus } from '../../../generated/prisma/enums.js';
import { EXAM_LIMITS } from './exam-rules.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class ExamSectionInputDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'section title can’t be empty' })
  @MaxLength(120)
  title: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  /** Required when the exam is section-timed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXAM_LIMITS.durationMinutes)
  durationMinutes?: number | null;

  /** Null = each question's own marks. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  marksPerQuestion?: number | null;

  @IsInt()
  @Min(0)
  @Max(100)
  negativeMarkPercent: number = 0;

  @IsBoolean()
  partialScoring: boolean = true;

  /** In display order. */
  @IsUUID('all', { each: true })
  @ArrayMaxSize(EXAM_LIMITS.questionsPerSection)
  questionIds: string[] = [];
}

/** POST /admin/exams and PUT /admin/exams/:id (full replace). */
export class ExamInputDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'title must be at least 3 characters' })
  @MaxLength(200)
  title: string;

  @IsIn(Object.values(ExamKind))
  kind: ExamKind = 'mock_exam';

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'add instructions for candidates' })
  @MaxLength(20000)
  instructions: string;

  /** Ignored for section-timed exams (the sum of the sections is used). */
  @IsInt()
  @Min(1)
  @Max(EXAM_LIMITS.durationMinutes)
  durationMinutes: number;

  @IsBoolean()
  sectionTimed: boolean = false;

  @IsBoolean()
  pauseOnDisconnect: boolean = true;

  @IsBoolean()
  shuffleQuestions: boolean = false;

  @IsBoolean()
  shuffleOptions: boolean = false;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxAttempts?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passPercent?: number | null;

  @ValidateNested({ each: true })
  @Type(() => ExamSectionInputDto)
  @ArrayMaxSize(EXAM_LIMITS.sections)
  sections: ExamSectionInputDto[] = [];
}

/** GET /admin/exams */
export class ListExamsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(ExamStatus))
  status?: ExamStatus;

  @IsOptional()
  @IsIn(Object.values(ExamKind))
  kind?: ExamKind;

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
