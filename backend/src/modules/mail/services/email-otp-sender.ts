import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { OtpMessage, OtpSender } from '../../auth/services/otp-sender.js';
import { MailService } from './mail.service.js';

const ROLE_LABELS: Record<string, string> = {
  editor: 'Editor',
  support: 'Support',
  admin: 'Admin',
};

/**
 * Delivers OTP codes by email (replaces Step 2's ConsoleOtpSender). Only
 * queues the message, so auth endpoints never wait on SMTP.
 */
@Injectable()
export class EmailOtpSender implements OtpSender {
  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  async send(message: OtpMessage): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: message.email, deletedAt: null },
      select: { id: true, name: true },
    });
    const common = {
      email: message.email,
      code: message.code,
      expiresInMinutes: Math.round(message.expiresInSeconds / 60),
      name: user?.name,
    };
    const base = { to: message.email, userId: user?.id };

    if (message.purpose === 'verify_email') {
      await this.mail.enqueue({
        ...base,
        template: 'verify_email',
        data: common,
      });
    } else if (message.intent === 'staff_invite') {
      await this.mail.enqueue({
        ...base,
        template: 'staff_invite',
        data: { ...common, role: ROLE_LABELS[message.role ?? ''] ?? 'staff' },
      });
    } else {
      await this.mail.enqueue({
        ...base,
        template: 'reset_password',
        data: common,
      });
    }
  }
}
