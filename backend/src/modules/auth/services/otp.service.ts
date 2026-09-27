import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { EnvVars } from '../../../config/env.validation.js';
import { RedisService } from '../../../database/redis.service.js';
import { AuthError } from '../models/auth-error.js';
import { OTP_SENDER, type OtpPurpose, type OtpSender } from './otp-sender.js';

const hashCode = (code: string) =>
  createHash('sha256').update(code).digest('hex');

/**
 * Redis-backed one-time codes (FRD §4.1). Keys per purpose + email:
 *   otp:<purpose>:<email>:code      sha256(code), expires after OTP_TTL_SECONDS
 *   otp:<purpose>:<email>:attempts  wrong-guess counter, same TTL
 *   otp:<purpose>:<email>:cooldown  blocks re-sending for OTP_RESEND_COOLDOWN_SECONDS
 */
@Injectable()
export class OtpService {
  private readonly ttl: number;
  private readonly maxAttempts: number;
  private readonly cooldown: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<EnvVars, true>,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {
    this.ttl = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.cooldown = config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
  }

  /** Generates, stores and sends a new code (replacing any previous one). */
  async issue(purpose: OtpPurpose, email: string): Promise<void> {
    const keys = this.keys(purpose, email);

    if (this.cooldown > 0) {
      const acquired = await this.redis.set(
        keys.cooldown,
        '1',
        'EX',
        this.cooldown,
        'NX',
      );
      if (acquired !== 'OK') {
        const retryAfterSeconds = Math.max(
          await this.redis.ttl(keys.cooldown),
          1,
        );
        throw new AuthError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_COOLDOWN',
          `Please wait ${retryAfterSeconds}s before requesting another code`,
          { retryAfterSeconds },
        );
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(keys.code, hashCode(code), 'EX', this.ttl);
    await this.redis.del(keys.attempts);
    await this.sender.send({
      email,
      code,
      purpose,
      expiresInSeconds: this.ttl,
    });
  }

  /** Consumes the code if it matches; throws otherwise. */
  async verify(
    purpose: OtpPurpose,
    email: string,
    code: string,
  ): Promise<void> {
    const keys = this.keys(purpose, email);

    // Count the attempt before comparing so concurrent guesses can't exceed the limit.
    const attempts = await this.redis.incr(keys.attempts);
    if (attempts === 1) await this.redis.expire(keys.attempts, this.ttl);

    const stored = await this.redis.get(keys.code);
    if (!stored) {
      await this.redis.del(keys.attempts);
      throw new AuthError(
        HttpStatus.BAD_REQUEST,
        'OTP_EXPIRED',
        'This code has expired or was never issued. Request a new one.',
      );
    }

    if (attempts > this.maxAttempts || !this.matches(stored, code)) {
      if (attempts >= this.maxAttempts) {
        await this.redis.del(keys.code, keys.attempts);
        throw new AuthError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_ATTEMPTS_EXCEEDED',
          'Too many incorrect attempts. Request a new code.',
        );
      }
      throw new AuthError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID',
        'Incorrect code',
        { attemptsRemaining: this.maxAttempts - attempts },
      );
    }

    await this.redis.del(keys.code, keys.attempts);
  }

  private matches(storedHash: string, code: string): boolean {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(hashCode(code), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private keys(purpose: OtpPurpose, email: string) {
    const base = `otp:${purpose}:${email}`;
    return {
      code: `${base}:code`,
      attempts: `${base}:attempts`,
      cooldown: `${base}:cooldown`,
    };
  }
}
