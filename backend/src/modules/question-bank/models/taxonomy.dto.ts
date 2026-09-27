import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TagKind } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE =
  'slug must be lowercase letters, digits and single hyphens';

export class CreateTopicDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /** Defaults to a slug of the name. Used by bulk import to reference the topic. */
  @IsOptional()
  @Transform(trim)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateTopicDto extends PartialType(CreateTopicDto) {}

export class CreateTagDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Transform(trim)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  @MaxLength(60)
  slug?: string;

  /** `company` tags power "asked at Google/Amazon…" filters (Step 19). */
  @IsOptional()
  @IsIn(Object.values(TagKind))
  kind?: TagKind;
}

export class UpdateTagDto extends PartialType(CreateTagDto) {}
