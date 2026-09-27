import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service.js';
import { MAIL_QUEUE, type MailJob } from '../models/mail.model.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { MailService } from './mail.service.js';

/**
 * Background sender (FRD §4.5). Each attempt updates the mail record; a
 * thrown error makes BullMQ retry with exponential backoff until
 * `attempts` is exhausted, after which the record is marked `failed`.
 */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {
    super();
  }

  async process(job: Job<MailJob>): Promise<void> {
    const { mailId, template, data } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    const record = await this.prisma.mailMessage.findUnique({
      where: { id: mailId },
    });
    if (!record) {
      this.logger.warn(`Mail ${mailId} no longer exists; dropping job`);
      return;
    }
    if (record.status === 'sent') return; // idempotent on duplicate delivery

    await this.prisma.mailMessage.update({
      where: { id: mailId },
      data: { status: 'sending', attempts: attempt, lastAttemptAt: new Date() },
    });

    try {
      const rendered = this.mail.render(template, data);
      const { messageId } = await this.transport.send({
        to: record.toAddress,
        ...rendered,
      });
      await this.prisma.mailMessage.update({
        where: { id: mailId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMessageId: messageId.slice(0, 255),
          lastError: null,
        },
      });
    } catch (err) {
      const final = attempt >= maxAttempts;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Mail ${mailId} attempt ${attempt}/${maxAttempts} failed: ${message}`,
      );
      await this.prisma.mailMessage.update({
        where: { id: mailId },
        data: {
          status: final ? 'failed' : 'retrying',
          lastError: message.slice(0, 1000),
          failedAt: final ? new Date() : null,
        },
      });
      throw err; // let BullMQ schedule the retry (or give up)
    }
  }
}
