import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { AuthError } from '../models/auth-error.js';
import {
  toPublicUser,
  type IssuedSession,
  type PublicUser,
  type RequestMeta,
} from '../models/auth-response.model.js';
import type {
  LoginDto,
  OtpDto,
  RegisterDto,
  ResetPasswordDto,
} from '../models/auth.dto.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Swallows OTP resend cooldowns where revealing them would leak account state. */
const ignoreCooldown = (err: unknown) => {
  if (err instanceof AuthError && err.code === 'OTP_COOLDOWN') return;
  throw err;
};

@Injectable()
export class AuthService {
  private readonly maxFailedLogins: number;
  private readonly lockoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.maxFailedLogins = config.get('AUTH_MAX_FAILED_LOGINS', {
      infer: true,
    });
    this.lockoutMs =
      config.get('AUTH_LOCKOUT_MINUTES', { infer: true }) * 60_000;
  }

  /**
   * Sign-up. Creates the user as pending_verification and emails an OTP.
   * Re-registering an email that was never verified overwrites the pending
   * details, so an abandoned sign-up can't block the address.
   */
  async register(dto: RegisterDto): Promise<{ email: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (
      existing &&
      (existing.status !== 'pending_verification' || existing.deletedAt)
    ) {
      throw this.emailTaken();
    }

    const data = {
      name: dto.name,
      phone: dto.phone,
      passwordHash: await this.passwords.hash(dto.password),
    };
    try {
      if (existing) {
        await this.prisma.user.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.user.create({ data: { ...data, email: dto.email } });
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw this.emailTaken();
      throw err;
    }

    // Within the cooldown the previously sent code is still valid.
    await this.otp.issue('verify_email', dto.email).catch(ignoreCooldown);
    return { email: dto.email };
  }

  /** Confirms the email OTP, activates the account and logs the user in. */
  async verifyEmail(dto: OtpDto, meta: RequestMeta): Promise<IssuedSession> {
    await this.otp.verify('verify_email', dto.email, dto.code);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user || user.status !== 'pending_verification') {
      throw new AuthError(
        HttpStatus.CONFLICT,
        'ALREADY_VERIFIED',
        'This email is already verified. Please log in.',
      );
    }

    const activated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'active',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
    return this.tokens.issueSession(activated, meta);
  }

  /** Re-sends the verification OTP. Silent for unknown/verified emails. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: 'pending_verification' },
    });
    if (user) await this.otp.issue('verify_email', email);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user?.passwordHash) {
      await this.passwords.verifyDummy(dto.password);
      throw this.invalidCredentials();
    }

    // FRD §4.1: locked accounts are rejected before the password is checked.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw this.accountLocked(user.lockedUntil);
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      await this.recordFailedLogin(user.id);
      throw this.invalidCredentials();
    }

    if (user.status === 'pending_verification') {
      throw new AuthError(
        HttpStatus.FORBIDDEN,
        'EMAIL_NOT_VERIFIED',
        'Please verify your email before logging in.',
        { email: user.email },
      );
    }
    if (user.status === 'suspended') {
      throw new AuthError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_SUSPENDED',
        'This account has been suspended. Contact support.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    return this.tokens.issueSession(updated, meta);
  }

  refresh(rawToken: string | undefined, meta: RequestMeta) {
    if (!rawToken) {
      throw new AuthError(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_TOKEN_INVALID',
        'Session expired. Please log in again.',
      );
    }
    return this.tokens.rotate(rawToken, meta);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revoke(rawToken);
  }

  /** Always succeeds from the caller's view so emails can't be enumerated. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: { not: 'suspended' } },
    });
    if (user) {
      await this.otp.issue('reset_password', email).catch(ignoreCooldown);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    await this.otp.verify('reset_password', dto.email, dto.code);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user) {
      throw new AuthError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID',
        'Invalid code',
      );
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Receiving the OTP proves ownership of the inbox.
        ...(user.status === 'pending_verification' && {
          status: 'active',
          emailVerifiedAt: now,
        }),
      },
    });
    await this.tokens.revokeAllForUser(user.id);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new AuthError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'User no longer exists',
      );
    }
    return toPublicUser(user);
  }

  /** FRD §4.1 lockout: the Nth consecutive failure locks the account. */
  private async recordFailedLogin(userId: string): Promise<void> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= this.maxFailedLogins) {
      const lockedUntil = new Date(Date.now() + this.lockoutMs);
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil },
      });
      throw this.accountLocked(lockedUntil);
    }
  }

  private emailTaken() {
    return new AuthError(
      HttpStatus.CONFLICT,
      'EMAIL_TAKEN',
      'An account with this email already exists.',
    );
  }

  private invalidCredentials() {
    return new AuthError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CREDENTIALS',
      'Incorrect email or password.',
    );
  }

  private accountLocked(lockedUntil: Date) {
    return new AuthError(
      423, // Locked
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Try again later or reset your password.',
      { lockedUntil: lockedUntil.toISOString() },
    );
  }
}
