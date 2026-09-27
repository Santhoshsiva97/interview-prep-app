import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Trims strings; blank strings become null (= clear the field). */
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const profileUrl = (host: string) =>
  Matches(new RegExp(`^https://(www\\.)?${host.replace('.', '\\.')}/`, 'i'), {
    message: `must be a https://${host}/… link`,
  });

/**
 * PATCH semantics: omitted fields are left unchanged, `null`/blank clears an
 * optional field. `name` and `phone` can be changed but not cleared. Email is
 * not editable here (changing it needs re-verification).
 */
export class UpdateProfileDto {
  @ValidateIf((o: UpdateProfileDto) => o.name !== undefined)
  @Transform(trimToNull)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ValidateIf((o: UpdateProfileDto) => o.phone !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s-]/g, '') : value,
  )
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be in international format, e.g. +919876543210',
  })
  phone?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  headline?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  targetRole?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceYears?: number | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @profileUrl('linkedin.com')
  @MaxLength(255)
  linkedinUrl?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @profileUrl('github.com')
  @MaxLength(255)
  githubUrl?: string | null;
}
