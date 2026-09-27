import type { MailTemplateName, MailTemplates } from '../templates/index.js';

export const MAIL_QUEUE = 'mail';

/** BullMQ job payload. Holds the template data (may include a one-time code),
 * so completed jobs are removed from Redis immediately. */
export interface MailJob<T extends MailTemplateName = MailTemplateName> {
  mailId: string;
  template: T;
  data: MailTemplates[T];
}

export interface EnqueueMail<T extends MailTemplateName> {
  to: string;
  template: T;
  data: MailTemplates[T];
  /** Links the delivery record to an account (for support look-ups). */
  userId?: string;
}
