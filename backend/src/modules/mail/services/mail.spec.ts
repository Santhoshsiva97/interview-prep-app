import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env.validation.js';
import type { Job, Queue } from 'bullmq';
import {
  CapturingTransport,
  FakeQueue,
} from '../../../../test/utils/fake-mail.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { MailJob } from '../models/mail.model.js';
import { EmailOtpSender } from './email-otp-sender.js';
import { MailProcessor } from './mail.processor.js';
import { MailService } from './mail.service.js';

/** Minimal in-memory mailMessage/user tables. */
function fakePrisma() {
  const mails = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    mails,
    user: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'u1', name: 'Priya Sharma' }),
      ),
    },
    mailMessage: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${++seq}`, status: 'queued', attempts: 0, ...data };
        mails.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = { ...mails.get(where.id)!, ...data };
          mails.set(where.id, row);
          return Promise.resolve(row);
        },
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(mails.get(where.id) ?? null),
      ),
    },
  };
}

const config = {
  get: (k: string) =>
    ({
      APP_BASE_URL: 'https://app.example.com/',
      MAIL_MAX_ATTEMPTS: 3,
      MAIL_RETRY_BASE_DELAY_MS: 10_000,
    })[k],
} as unknown as ConfigService<EnvVars, true>;

describe('mail pipeline', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let queue: FakeQueue;
  let transport: CapturingTransport;
  let mail: MailService;
  let processor: MailProcessor;

  beforeEach(() => {
    prisma = fakePrisma();
    queue = new FakeQueue();
    transport = new CapturingTransport();
    mail = new MailService(
      prisma as unknown as PrismaService,
      queue as unknown as Queue<MailJob>,
      config,
    );
    processor = new MailProcessor(
      prisma as unknown as PrismaService,
      mail,
      transport,
    );
    queue.useProcessor((job) =>
      processor.process(job as unknown as Job<MailJob>),
    );
  });

  const enqueueVerify = () =>
    mail.enqueue({
      to: 'priya@example.com',
      template: 'verify_email',
      data: {
        email: 'priya@example.com',
        code: '123456',
        expiresInMinutes: 10,
      },
    });

  it('records the mail and queues it with 3 attempts + exponential backoff (no inline send)', async () => {
    const id = await enqueueVerify();

    expect(prisma.mails.get(id)).toMatchObject({
      toAddress: 'priya@example.com',
      template: 'verify_email',
      subject: 'Your InterviewPrep verification code',
      status: 'queued',
      maxAttempts: 3,
    });
    expect(queue.jobs[0].opts).toMatchObject({
      jobId: id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
    });
    expect(transport.sent).toHaveLength(0); // nothing sent until the worker runs
  });

  it('worker sends and marks the record sent', async () => {
    const id = await enqueueVerify();
    await queue.drain();

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe('priya@example.com');
    expect(transport.lastCode('priya@example.com')).toBe('123456');
    expect(prisma.mails.get(id)).toMatchObject({
      status: 'sent',
      attempts: 1,
      providerMessageId: '<fake-1@test>',
      lastError: null,
    });
  });

  it('retries after a failure and records the attempt count', async () => {
    transport.failNext = 2;
    const id = await enqueueVerify();
    await queue.drain();

    expect(transport.sent).toHaveLength(1);
    expect(prisma.mails.get(id)).toMatchObject({ status: 'sent', attempts: 3 });
  });

  it('marks the mail failed after the last attempt', async () => {
    transport.failNext = 5;
    const id = await enqueueVerify();

    const job = { data: queue.jobs[0].data, opts: queue.jobs[0].opts };
    await expect(
      processor.process({ ...job, attemptsMade: 0 } as unknown as Job<MailJob>),
    ).rejects.toThrow('SMTP 421');
    expect(prisma.mails.get(id)).toMatchObject({
      status: 'retrying',
      attempts: 1,
      failedAt: null,
    });

    await expect(
      processor.process({ ...job, attemptsMade: 2 } as unknown as Job<MailJob>),
    ).rejects.toThrow();
    expect(prisma.mails.get(id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'SMTP 421 Service not available',
    });
    expect(prisma.mails.get(id)!.failedAt).toBeInstanceOf(Date);
  });

  it('does not resend a mail that is already sent', async () => {
    const id = await enqueueVerify();
    await queue.drain();
    await processor.process({
      data: { mailId: id, template: 'verify_email', data: {} },
      opts: { attempts: 3 },
      attemptsMade: 0,
    } as unknown as Job<MailJob>);
    expect(transport.sent).toHaveLength(1);
  });

  it('marks the record failed and rethrows when the queue is unavailable', async () => {
    queue.failAdd = true;
    await expect(enqueueVerify()).rejects.toMatchObject({
      code: 'MAIL_UNAVAILABLE',
    });
    const [row] = [...prisma.mails.values()];
    expect(row).toMatchObject({ status: 'failed' });
    expect(String(row.lastError)).toContain('Could not queue');
  });

  describe('EmailOtpSender', () => {
    const send = (msg: Partial<Parameters<EmailOtpSender['send']>[0]>) =>
      new EmailOtpSender(mail, prisma as unknown as PrismaService).send({
        email: 'priya@example.com',
        code: '654321',
        purpose: 'verify_email',
        expiresInSeconds: 600,
        ...msg,
      });

    it('picks the template from purpose/intent and personalises it', async () => {
      await send({ purpose: 'verify_email' });
      await send({ purpose: 'reset_password' });
      await send({
        purpose: 'reset_password',
        intent: 'staff_invite',
        role: 'editor',
      });
      await queue.drain();

      expect([...prisma.mails.values()].map((m) => m.template)).toEqual([
        'verify_email',
        'reset_password',
        'staff_invite',
      ]);
      expect([...prisma.mails.values()].every((m) => m.userId === 'u1')).toBe(
        true,
      );
      expect(transport.sent[0].text).toContain('expires in 10 minutes');
      expect(transport.sent[2].subject).toContain('as Editor');
      expect(transport.sent[0].html).toContain('Hi Priya');
    });
  });
});
