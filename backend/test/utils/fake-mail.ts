import type { JobsOptions } from 'bullmq';
import type { MailJob } from '../../src/modules/mail/models/mail.model.js';
import type {
  MailTransport,
  OutgoingMail,
} from '../../src/modules/mail/services/mail-transport.js';

/** Records sent mail; can be told to fail the next N sends. */
export class CapturingTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];
  failNext = 0;

  send(mail: OutgoingMail) {
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new Error('SMTP 421 Service not available'));
    }
    this.sent.push(mail);
    return Promise.resolve({ messageId: `<fake-${this.sent.length}@test>` });
  }

  /** Latest 6-digit code emailed to `to` (from the plain-text body). */
  lastCode(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No code emailed to ${to}`);
    return code;
  }
}

interface QueuedJob {
  data: MailJob;
  opts: JobsOptions;
}

type Process = (job: {
  data: MailJob;
  opts: JobsOptions;
  attemptsMade: number;
}) => Promise<void>;

/**
 * In-memory stand-in for the BullMQ `mail` queue. `drain()` runs queued jobs
 * through the real MailProcessor, retrying up to `opts.attempts` (no delays).
 */
export class FakeQueue {
  readonly jobs: QueuedJob[] = [];
  private processor?: Process;
  failAdd = false;

  add(_name: string, data: MailJob, opts: JobsOptions) {
    if (this.failAdd)
      return Promise.reject(new Error('Redis connection is closed'));
    this.jobs.push({ data, opts });
    return Promise.resolve({ id: opts.jobId });
  }

  useProcessor(process: Process) {
    this.processor = process;
  }

  async drain(): Promise<void> {
    if (!this.processor) throw new Error('FakeQueue: no processor set');
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      const attempts = job.opts.attempts ?? 1;
      for (let attemptsMade = 0; attemptsMade < attempts; attemptsMade++) {
        try {
          await this.processor({ ...job, attemptsMade });
          break;
        } catch {
          // retried by the loop, like BullMQ would after the backoff delay
        }
      }
    }
  }
}
