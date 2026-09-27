import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { AppError } from '../../../common/errors/app-error.js';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  MAIL_QUEUE,
  type EnqueueMail,
  type MailJob,
} from '../models/mail.model.js';
import {
  renderMail,
  type MailTemplateName,
  type MailTemplates,
  type RenderedMail,
} from '../templates/index.js';
import type { MailContext } from '../templates/layout.js';

/**
 * The only way to send email (FRD §4.5). Request handlers call `enqueue`,
 * which records the message and hands it to BullMQ; MailProcessor does the
 * actual SMTP send (with retries) in the background.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  readonly context: MailContext;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJob>,
    config: ConfigService<EnvVars, true>,
  ) {
    this.context = {
      appUrl: config.get('APP_BASE_URL', { infer: true }).replace(/\/+$/, ''),
      productName: 'InterviewPrep',
    };
    this.maxAttempts = config.get('MAIL_MAX_ATTEMPTS', { infer: true });
    this.baseDelayMs = config.get('MAIL_RETRY_BASE_DELAY_MS', { infer: true });
  }

  render<T extends MailTemplateName>(
    template: T,
    data: MailTemplates[T],
  ): RenderedMail {
    return renderMail(template, data, this.context);
  }

  /** Records and queues an email. Returns the mail record id. Never sends inline. */
  async enqueue<T extends MailTemplateName>(
    mail: EnqueueMail<T>,
  ): Promise<string> {
    // Render once up front: validates the data and gives us the subject for the log.
    const { subject } = this.render(mail.template, mail.data);
    const record = await this.prisma.mailMessage.create({
      data: {
        toAddress: mail.to,
        template: mail.template,
        subject,
        userId: mail.userId,
        maxAttempts: this.maxAttempts,
      },
    });

    try {
      await this.queue.add(
        'send',
        { mailId: record.id, template: mail.template, data: mail.data },
        {
          jobId: record.id,
          // FRD §4.5: up to 3 attempts with exponential backoff (10s, 20s, …).
          attempts: this.maxAttempts,
          backoff: { type: 'exponential', delay: this.baseDelayMs },
          // Job data can contain one-time codes: don't keep it around.
          removeOnComplete: true,
          removeOnFail: { age: 24 * 3600 },
        },
      );
    } catch (err) {
      this.logger.error(`Could not queue mail ${record.id}: ${String(err)}`);
      await this.prisma.mailMessage.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          failedAt: new Date(),
          lastError: `Could not queue: ${String(err)}`.slice(0, 1000),
        },
      });
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'MAIL_UNAVAILABLE',
        'We couldn’t send the email right now. Please try again in a minute.',
      );
    }
    return record.id;
  }
}
