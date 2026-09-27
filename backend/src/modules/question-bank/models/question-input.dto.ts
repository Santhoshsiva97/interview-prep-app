import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Difficulty, QuestionType } from '../../../generated/prisma/enums.js';
import { LIMITS } from './question-content.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class McqOptionDto {
  /** Keep existing ids when editing so answer keys stay valid. */
  @IsOptional()
  @Matches(/^[a-z0-9]{1,16}$/, {
    message: 'option id must be 1–16 lowercase letters/digits',
  })
  id?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'option text can’t be empty' })
  @MaxLength(1000)
  text: string;

  @IsBoolean()
  isCorrect: boolean;
}

export class McqContentDto {
  @ValidateNested({ each: true })
  @Type(() => McqOptionDto)
  @ArrayMinSize(LIMITS.mcqOptions.min, {
    message: `add at least ${LIMITS.mcqOptions.min} options`,
  })
  @ArrayMaxSize(LIMITS.mcqOptions.max, {
    message: `at most ${LIMITS.mcqOptions.max} options`,
  })
  options: McqOptionDto[];

  @IsBoolean()
  allowMultiple: boolean = false;
}

export class TestCaseDto {
  @IsString()
  @MaxLength(LIMITS.testCaseBytes)
  input: string;

  @IsString()
  @MinLength(1, { message: 'expected output can’t be empty' })
  @MaxLength(LIMITS.testCaseBytes)
  expectedOutput: string;

  @IsBoolean()
  isSample: boolean = false;

  @IsInt()
  @Min(1)
  @Max(100)
  weight: number = 1;
}

export class CodingContentDto {
  @IsInt()
  @Min(100)
  @Max(10_000)
  timeLimitMs: number = 2000;

  @IsInt()
  @Min(16)
  @Max(1024)
  memoryLimitMb: number = 256;

  /** `{ python: "...", javascript: "..." }` (languages checked in contentProblems). */
  @IsOptional()
  @IsObject()
  starterCode?: Record<string, string>;

  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  @ArrayMinSize(LIMITS.testCases.min, { message: 'add at least one test case' })
  @ArrayMaxSize(LIMITS.testCases.max)
  testCases: TestCaseDto[];
}

/**
 * Full question content, as sent by the editor (create and every edit) and
 * produced by bulk import after resolving topic/tag names to ids.
 */
export class QuestionInputDto {
  @IsIn(Object.values(QuestionType))
  type: QuestionType;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  /** Markdown. */
  @IsString()
  @MinLength(1, { message: 'body can’t be empty' })
  @MaxLength(20_000)
  body: string;

  @IsUUID()
  topicId: string;

  @IsIn(Object.values(Difficulty))
  difficulty: Difficulty;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(10_000)
  explanation?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  marks: number = 1;

  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(LIMITS.tags)
  tagIds: string[] = [];

  @IsOptional()
  @ValidateNested()
  @Type(() => McqContentDto)
  mcq?: McqContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CodingContentDto)
  coding?: CodingContentDto;

  /** Shown in version history, e.g. "Fixed typo in option B". */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class RejectQuestionDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, {
    message: 'Tell the author what to fix (at least 3 characters).',
  })
  @MaxLength(1000)
  note: string;
}
