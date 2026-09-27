import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EnvVars } from '../../../config/env.validation.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one fully rendered email. Throwing = failed attempt (the queue retries). */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Real delivery through any SMTP relay (SendGrid, SES, Mailpit, …) via Nodemailer. */
export class SmtpMailTransport implements MailTransport {
  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(mail: OutgoingMail) {
    const info = await this.transporter.sendMail({
      from: this.from,
      replyTo: this.replyTo,
      ...mail,
    });
    return { messageId: String(info.messageId) };
  }
}

/**
 * Dev/test only (config validation forbids it in production): builds the
 * message with Nodemailer's JSON transport and logs it instead of sending.
 */
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail');
  private readonly transporter = nodemailer.createTransport({
    jsonTransport: true,
  });

  constructor(private readonly from: string) {}

  async send(mail: OutgoingMail) {
    const info = await this.transporter.sendMail({ from: this.from, ...mail });
    this.logger.log(
      `[DEV MAIL] to=${mail.to} subject="${mail.subject}"\n${mail.text}`,
    );
    return { messageId: String(info.messageId) };
  }
}

export function createMailTransport(
  config: ConfigService<EnvVars, true>,
): MailTransport {
  const from = config.get('MAIL_FROM', { infer: true });
  if (config.get('MAIL_TRANSPORT', { infer: true }) === 'log') {
    return new LogMailTransport(from);
  }
  const user = config.get('SMTP_USER', { infer: true });
  const pass = config.get('SMTP_PASS', { infer: true });
  const transporter = nodemailer.createTransport({
    host: config.get('SMTP_HOST', { infer: true }),
    port: config.get('SMTP_PORT', { infer: true }),
    secure: config.get('SMTP_SECURE', { infer: true }),
    auth: user && pass ? { user, pass } : undefined,
    pool: true,
    // Fail fast so a hung relay turns into a retry instead of a stuck worker.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return new SmtpMailTransport(
    transporter,
    from,
    config.get('MAIL_REPLY_TO', { infer: true }),
  );
}
