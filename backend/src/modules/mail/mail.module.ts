import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { redisOptionsFromUrl } from '../../queue/queue.module.js';
import { AdminMailController } from './controllers/admin-mail.controller.js';
import { MAIL_QUEUE } from './models/mail.model.js';
import { EmailOtpSender } from './services/email-otp-sender.js';
import {
  createMailTransport,
  MAIL_TRANSPORT,
} from './services/mail-transport.js';
import { MailService } from './services/mail.service.js';

/**
 * Mail producer side (FRD §4.5): templates, the `mail` queue, delivery log.
 * The consumer (MailProcessor) lives in MailWorkerModule.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      inject: [ConfigService],
      // Producer connection: fail fast when Redis is down so an HTTP request
      // gets an error instead of hanging (workers use the shared blocking one).
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        connection: {
          ...redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        },
      }),
    }),
  ],
  controllers: [AdminMailController],
  providers: [
    MailService,
    EmailOtpSender,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: createMailTransport,
    },
  ],
  exports: [MailService, EmailOtpSender, MAIL_TRANSPORT],
})
export class MailModule {}
