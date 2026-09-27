import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { RedisService } from '../../database/redis.service.js';

/**
 * Makes "log out everywhere" take effect immediately. Access tokens are
 * stateless JWTs, so revoking refresh tokens alone leaves already-issued access
 * tokens valid until they expire. We store a per-user "revoked before"
 * timestamp in Redis (for one access-token lifetime) and JwtAuthGuard rejects
 * any token issued before it.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.ttlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  async revokeAccessTokens(userId: string): Promise<void> {
    await this.redis.set(
      this.key(userId),
      String(Date.now()),
      'EX',
      this.ttlSeconds,
    );
  }

  /** True if a token issued at `issuedAtMs` predates a revocation. */
  async isRevoked(userId: string, issuedAtMs: number): Promise<boolean> {
    try {
      const revokedAtMs = await this.redis.get(this.key(userId));
      return revokedAtMs !== null && issuedAtMs <= Number(revokedAtMs);
    } catch (err) {
      // Fail open: refresh tokens are already revoked in Postgres, so the
      // worst case is an access token living out its (short) lifetime.
      this.logger.warn(`Revocation check unavailable: ${String(err)}`);
      return false;
    }
  }

  private key(userId: string) {
    return `auth:revoked-before:${userId}`;
  }
}
