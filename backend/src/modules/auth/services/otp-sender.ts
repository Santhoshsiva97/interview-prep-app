import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env.validation.js';

export type OtpPurpose = 'verify_email' | 'reset_password';

export interface OtpMessage {
  email: string;
  code: string;
  purpose: OtpPurpose;
  expiresInSeconds: number;
}

/**
 * Delivery channel for OTP codes. AuthModule binds OTP_SENDER to
 * ConsoleOtpSender until Step 5 (Mail Module) provides an email-backed
 * implementation — swap the binding in auth.module.ts, nothing else changes.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** STUB (Step 5 replaces): logs the OTP instead of emailing it. */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OtpSender');

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  send({ email, code, purpose, expiresInSeconds }: OtpMessage): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      this.logger.error(
        `No mail transport configured — ${purpose} OTP for ${email} was NOT delivered`,
      );
    } else {
      this.logger.warn(
        `[DEV OTP] ${purpose} code for ${email}: ${code} (valid ${expiresInSeconds}s)`,
      );
    }
    return Promise.resolve();
  }
}
