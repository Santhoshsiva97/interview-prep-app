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
import { Difficulty, QuestionType } from '../../../generated/prisma/enums.js';

export const ANALYTICS_QUEUE = 'analytics';
export const QUESTION_STATS_JOB = 'question-stats';

export type AnalyticsJob = { type: typeof QUESTION_STATS_JOB };

/** `?format=csv` on any analytics view returns it as a CSV download. */
export class FormatQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

/** GET /admin/analytics/overview */
export class OverviewQueryDto extends FormatQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days = 30;
}

/** GET /admin/analytics/questions */
export class QuestionStatsQueryDto extends FormatQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(QuestionType))
  type?: QuestionType;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsIn(Object.values(Difficulty))
  difficulty?: Difficulty;

  @IsOptional()
  @IsIn(['too_easy', 'too_hard', 'unused'])
  flag?: 'too_easy' | 'too_hard' | 'unused';

  @IsOptional()
  @IsIn(['attempts', 'accuracy', 'avg_time', 'title'])
  sort: 'attempts' | 'accuracy' | 'avg_time' | 'title' = 'attempts';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir: 'asc' | 'desc' = 'desc';
}
