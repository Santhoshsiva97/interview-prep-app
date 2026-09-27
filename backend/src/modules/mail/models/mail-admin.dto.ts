import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MailStatus } from '../../../generated/prisma/enums.js';
import {
  MAIL_TEMPLATE_NAMES,
  type MailTemplateName,
} from '../templates/index.js';

/** GET /admin/mail */
export class ListMailQueryDto {
  /** Recipient address (case-insensitive substring). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(254)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(MailStatus))
  status?: MailStatus;

  @IsOptional()
  @IsIn(MAIL_TEMPLATE_NAMES)
  template?: MailTemplateName;

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
  pageSize = 25;
}
