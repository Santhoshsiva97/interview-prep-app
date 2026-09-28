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

interface QueuedJob<T> {
  data: T;
  opts: JobsOptions;
}

type Process<T> = (job: {
  data: T;
  opts: JobsOptions;
  attemptsMade: number;
}) => Promise<void>;

/**
 * In-memory stand-in for a BullMQ queue. `drain()` runs queued jobs through
 * the real processor, retrying up to `opts.attempts` (no delays). Like
 * BullMQ, adding a job whose `jobId` is already waiting is a no-op.
 */
export class FakeQueue<T = MailJob> {
  readonly jobs: QueuedJob<T>[] = [];
  private processor?: Process<T>;
  failAdd = false;

  add(_name: string, data: T, opts: JobsOptions) {
    if (this.failAdd)
      return Promise.reject(new Error('Redis connection is closed'));
    if (!opts.jobId || !this.jobs.some((j) => j.opts.jobId === opts.jobId))
      this.jobs.push({ data, opts });
    return Promise.resolve({ id: opts.jobId });
  }

  useProcessor(process: Process<T>) {
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
