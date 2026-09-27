import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
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
import { UserRole, UserStatus } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Roles a super admin can assign. super_admin itself is only granted via the CLI. */
export const ASSIGNABLE_ROLES = [
  UserRole.candidate,
  UserRole.editor,
  UserRole.support,
  UserRole.admin,
] as const;
export const STAFF_ROLES = [
  UserRole.editor,
  UserRole.support,
  UserRole.admin,
] as const;

export const USER_SORTS = ['newest', 'oldest', 'name', 'last_login'] as const;
export type UserSort = (typeof USER_SORTS)[number];

/** GET /admin/users query string. */
export class ListUsersQueryDto {
  /** Matches name, email or phone (case-insensitive substring). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  /** Shortcut filters: `staff` = every non-candidate role. */
  @IsOptional()
  @IsIn(['all', 'staff', 'candidates'])
  scope: 'all' | 'staff' | 'candidates' = 'all';

  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;

  @IsOptional()
  @IsIn(USER_SORTS)
  sort: UserSort = 'newest';

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

export class SuspendUserDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Please give a reason (at least 3 characters).' })
  @MaxLength(500)
  reason: string;
}

export class ChangeRoleDto {
  @IsIn(ASSIGNABLE_ROLES, {
    message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
  })
  role: (typeof ASSIGNABLE_ROLES)[number];
}

export class CreateStaffDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[\s-]/g, '') || undefined
      : value,
  )
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be in international format, e.g. +919876543210',
  })
  phone?: string;

  @IsIn(STAFF_ROLES, {
    message: `role must be one of: ${STAFF_ROLES.join(', ')}`,
  })
  role: (typeof STAFF_ROLES)[number];
}
