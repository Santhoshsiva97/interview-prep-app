import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma, type User } from '../../../generated/prisma/client.js';
import type { UserRole } from '../../../generated/prisma/enums.js';
import { OtpService } from '../../auth/services/otp.service.js';
import { TokenService } from '../../auth/services/token.service.js';
import { ProfileService } from '../../profile/services/profile.service.js';
import {
  toAdminUserSummary,
  type AdminUserDetail,
  type AdminUserSummary,
  type Paginated,
} from '../models/admin-response.model.js';
import type {
  CreateStaffDto,
  ListUsersQueryDto,
  UserSort,
} from '../models/admin.dto.js';

export type AdminErrorCode =
  | 'USER_NOT_FOUND'
  | 'CANNOT_MANAGE_SELF'
  | 'CANNOT_MANAGE_SUPER_ADMIN'
  | 'STAFF_REQUIRES_SUPER_ADMIN'
  | 'ALREADY_SUSPENDED'
  | 'NOT_SUSPENDED'
  | 'EMAIL_TAKEN';

const STAFF: UserRole[] = ['editor', 'support', 'admin', 'super_admin'];

const ORDER_BY: Record<UserSort, Prisma.UserOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }],
  oldest: [{ createdAt: 'asc' }],
  name: [{ name: 'asc' }, { createdAt: 'desc' }],
  last_login: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }],
};

const fail = (status: HttpStatus, code: AdminErrorCode, message: string) =>
  new AppError<AdminErrorCode>(status, code, message);

/** User management for the admin portal (FRD §4.3). */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly profiles: ProfileService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<Paginated<AdminUserSummary>> {
    const { search, role, scope, status, sort, page, pageSize } = query;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(scope === 'staff' && { role: { not: 'candidate' } }),
      ...(scope === 'candidates' && { role: 'candidate' }),
      ...(role && { role }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search.replace(/[\s-]/g, '') } },
        ],
      }),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: ORDER_BY[sort],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: users.map(toAdminUserSummary),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { suspendedBy: { select: { id: true, name: true } } },
    });
    if (!user) throw this.notFound();

    const [{ profile, avatarUrl, resume }, activeSessions] = await Promise.all([
      this.profiles.get(id),
      this.tokens.countActiveSessions(id),
    ]);
    return {
      ...toAdminUserSummary(user),
      failedLoginAttempts: user.failedLoginAttempts,
      hasPassword: user.passwordHash !== null,
      activeSessions,
      suspension: user.suspendedAt
        ? {
            at: user.suspendedAt,
            reason: user.suspensionReason,
            by: user.suspendedBy,
          }
        : null,
      profile,
      avatarUrl,
      resume,
    };
  }

  /** Blocks login and ends all sessions immediately. */
  async suspend(
    actor: AuthUser,
    id: string,
    reason: string,
  ): Promise<AdminUserDetail> {
    const target = await this.findManageable(actor, id);
    if (target.status === 'suspended') {
      throw fail(
        HttpStatus.CONFLICT,
        'ALREADY_SUSPENDED',
        'This account is already suspended.',
      );
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedById: actor.id,
        suspensionReason: reason,
      },
    });
    await this.tokens.revokeAllForUser(id);
    return this.get(id);
  }

  async reactivate(actor: AuthUser, id: string): Promise<AdminUserDetail> {
    const target = await this.findManageable(actor, id);
    if (target.status !== 'suspended') {
      throw fail(
        HttpStatus.CONFLICT,
        'NOT_SUSPENDED',
        'This account is not suspended.',
      );
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        // Accounts that never verified their email go back to pending.
        status: target.emailVerifiedAt ? 'active' : 'pending_verification',
        suspendedAt: null,
        suspendedById: null,
        suspensionReason: null,
      },
    });
    return this.get(id);
  }

  /** Signs the user out of every device without blocking future logins. */
  async forceLogout(
    actor: AuthUser,
    id: string,
  ): Promise<{ revokedSessions: number }> {
    await this.findManageable(actor, id);
    return { revokedSessions: await this.tokens.revokeAllForUser(id) };
  }

  /** Super admin only (enforced by the route). Ends sessions so the new role applies at once. */
  async changeRole(
    actor: AuthUser,
    id: string,
    role: UserRole,
  ): Promise<AdminUserDetail> {
    const target = await this.findManageable(actor, id);
    if (target.role !== role) {
      await this.prisma.user.update({ where: { id }, data: { role } });
      await this.tokens.revokeAllForUser(id);
    }
    return this.get(id);
  }

  /**
   * Super admin only. Creates a passwordless staff account and emails an
   * account-setup code; the new staff member sets a password through the
   * normal reset-password screen (which also verifies their email).
   */
  async createStaff(dto: CreateStaffDto): Promise<AdminUserSummary> {
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          role: dto.role,
          status: 'pending_verification',
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw fail(
          HttpStatus.CONFLICT,
          'EMAIL_TAKEN',
          'An account with this email already exists. Change its role from the user page instead.',
        );
      }
      throw err;
    }
    await this.otp.issue('reset_password', user.email, {
      intent: 'staff_invite',
      role: dto.role,
    });
    return toAdminUserSummary(user);
  }

  /**
   * Who may act on whom:
   *  - nobody acts on their own account (no self-suspension or self-demotion);
   *  - super_admin accounts can't be managed through the API;
   *  - only super_admin may manage other staff (admins manage candidates).
   */
  private async findManageable(actor: AuthUser, id: string): Promise<User> {
    const target = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw this.notFound();
    if (target.id === actor.id) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'CANNOT_MANAGE_SELF',
        'You can’t perform this action on your own account.',
      );
    }
    if (target.role === 'super_admin') {
      throw fail(
        HttpStatus.FORBIDDEN,
        'CANNOT_MANAGE_SUPER_ADMIN',
        'Super admin accounts can’t be managed here.',
      );
    }
    if (STAFF.includes(target.role) && actor.role !== 'super_admin') {
      throw fail(
        HttpStatus.FORBIDDEN,
        'STAFF_REQUIRES_SUPER_ADMIN',
        'Only a super admin can manage staff accounts.',
      );
    }
    return target;
  }

  private notFound() {
    return fail(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found.');
  }
}
