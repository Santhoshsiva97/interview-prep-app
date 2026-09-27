import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma, User } from '../../../generated/prisma/client.js';
import type { AccessTokenPayload } from '../../../common/types/auth-user.js';
import { AuthError } from '../models/auth-error.js';
import {
  toPublicUser,
  type IssuedSession,
  type RequestMeta,
} from '../models/auth-response.model.js';

/**
 * A revoked token presented again within this window is treated as a benign
 * race (two tabs refreshing at once) rather than token theft.
 */
const REUSE_GRACE_MS = 10_000;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const invalidRefreshToken = () =>
  new AuthError(
    HttpStatus.UNAUTHORIZED,
    'REFRESH_TOKEN_INVALID',
    'Session expired. Please log in again.',
  );

@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  /** Issues an access token + a new refresh token (new family unless given). */
  async issueSession(
    user: User,
    meta: RequestMeta,
    familyId: string = randomUUID(),
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedSession & { refreshTokenId: string }> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTtlMs);
    const row = await db.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        userAgent: meta.userAgent?.slice(0, 512),
        ipAddress: meta.ipAddress?.slice(0, 45),
      },
    });

    return {
      accessToken,
      expiresIn: this.accessTtlSeconds,
      user: toPublicUser(user),
      refreshToken,
      refreshTokenExpiresAt,
      refreshTokenId: row.id,
    };
  }

  /** Refresh-token rotation with reuse detection. */
  async rotate(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!existing) throw invalidRefreshToken();

    const now = new Date();
    if (existing.revokedAt) {
      if (now.getTime() - existing.revokedAt.getTime() > REUSE_GRACE_MS) {
        // A rotated-out token came back: assume it was stolen, kill the family.
        await this.revokeFamily(existing.familyId);
      }
      throw invalidRefreshToken();
    }

    const { user } = existing;
    if (
      existing.expiresAt <= now ||
      user.deletedAt ||
      user.status !== 'active'
    ) {
      await this.revokeFamily(existing.familyId);
      throw invalidRefreshToken();
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional update = atomic claim; loses cleanly to a concurrent rotation.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count === 0) throw invalidRefreshToken();

      const session = await this.issueSession(
        user,
        meta,
        existing.familyId,
        tx,
      );
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedById: session.refreshTokenId },
      });
      return session;
    });
  }

  /** Revokes a single refresh token (logout). Unknown tokens are ignored. */
  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session for a user (password reset, force-logout). */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
