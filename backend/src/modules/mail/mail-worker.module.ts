import { Module } from '@nestjs/common';
import { MailModule } from './mail.module.js';
import { MailProcessor } from './services/mail.processor.js';

/**
 * Mail consumer. Loaded only when MAIL_WORKER_ENABLED=true (the default), so
 * the same image can run as API-only with separate worker processes later.
 */
@Module({
  imports: [MailModule],
  providers: [MailProcessor],
})
export class MailWorkerModule {}
