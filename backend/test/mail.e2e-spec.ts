/**
 * Mail Module over HTTP against a real Postgres: OTP emails flow through
 * MailService → queue → MailProcessor → transport, with delivery status
 * recorded in mail_messages. Queue and SMTP are in-memory fakes.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { fakeConfig } from './utils/fake-config.js';
import { createTestApp, type TestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-mail.test';

describe.skipIf(!DB_URL)('Mail module (e2e)', () => {
  let t: TestApp;
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const http = () => request(app.getHttpServer());
  const cleanup = () =>
    prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  const register = (email: string) =>
    http().post('/api/v1/auth/register').send({
      name: 'Mail Test',
      email,
      phone: '+919800000000',
      password: 'secret123',
    });
  const record = (to: string) =>
    prisma.mailMessage.findFirst({
      where: { toAddress: to },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await prisma.mailMessage.deleteMany({
      where: { toAddress: { endsWith: DOMAIN } },
    });
    await cleanup();
    t = await createTestApp({ prisma });
    app = t.app;

    await prisma.user.create({
      data: {
        name: 'Mail Admin',
        email: `admin${DOMAIN}`,
        role: 'admin',
        status: 'active',
        emailVerifiedAt: new Date(),
        passwordHash: await hash('secret123'),
      },
    });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: `admin${DOMAIN}`, password: 'secret123' });
    adminToken = res.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.mailMessage.deleteMany({
        where: { toAddress: { endsWith: DOMAIN } },
      });
      await cleanup();
    }
    await app?.close();
  });

  it('sign-up queues a verification email; nothing is sent inside the request', async () => {
    const email = `queued${DOMAIN}`;
    await register(email).expect(201);

    expect(t.transport.sent.filter((m) => m.to === email)).toHaveLength(0);
    expect(await record(email)).toMatchObject({
      template: 'verify_email',
      status: 'queued',
      attempts: 0,
    });

    const code = await t.lastCode(email); // worker runs
    const mail = t.transport.sent.find((m) => m.to === email)!;
    expect(mail.subject).toBe('Your InterviewPrep verification code');
    expect(mail.html).toContain(code);
    expect(mail.html).toContain('Hi Mail'); // personalised from the new account
    expect(await record(email)).toMatchObject({
      status: 'sent',
      attempts: 1,
      lastError: null,
    });

    // The code from the email really verifies the account.
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ email, code })
      .expect(200);
  });

  it('retries a failed send and logs each attempt', async () => {
    const email = `flaky${DOMAIN}`;
    t.transport.failNext = 2;
    await register(email).expect(201);
    await t.queue.drain();

    expect(await record(email)).toMatchObject({
      status: 'sent',
      attempts: 3,
      lastError: null,
    });
    expect(t.transport.sent.filter((m) => m.to === email)).toHaveLength(1);
  });

  it('marks the email failed after 3 attempts', async () => {
    const email = `down${DOMAIN}`;
    t.transport.failNext = 3;
    await register(email).expect(201);
    await t.queue.drain();

    const row = await record(email);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 3,
      maxAttempts: 3,
      lastError: 'SMTP 421 Service not available',
    });
    expect(row!.failedAt).toBeInstanceOf(Date);
  });

  it('answers 503 (and allows an immediate retry) when the queue is down', async () => {
    const email = `noqueue${DOMAIN}`;
    t.queue.failAdd = true;
    await register(email)
      .expect(503)
      .expect(({ body }) => expect(body.code).toBe('MAIL_UNAVAILABLE'));
    t.queue.failAdd = false;

    // No 60s cooldown was left behind by the failed attempt.
    await http()
      .post('/api/v1/auth/verify-email/resend')
      .send({ email })
      .expect(202);
    await t.queue.drain();
    expect(await record(email)).toMatchObject({ status: 'sent' });
  });

  it('lets staff browse the delivery log and preview templates', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const { body } = await http()
      .get('/api/v1/admin/mail')
      .query({ search: DOMAIN, status: 'failed' })
      .set(auth)
      .expect(200);
    // Newest first: the unqueueable one, then the one that exhausted retries.
    expect(
      body.items.map((m: { toAddress: string; lastError: string }) => [
        m.toAddress,
        m.lastError.slice(0, 16),
      ]),
    ).toEqual([
      [`noqueue${DOMAIN}`, 'Could not queue:'],
      [`down${DOMAIN}`, 'SMTP 421 Service'],
    ]);
    expect(body.items[0]).not.toHaveProperty('html');

    const templates = await http()
      .get('/api/v1/admin/mail/templates')
      .set(auth)
      .expect(200);
    expect(templates.body.map((x: { name: string }) => x.name)).toEqual([
      'verify_email',
      'reset_password',
      'staff_invite',
      'exam_reminder',
    ]);

    const preview = await http()
      .get('/api/v1/admin/mail/templates/exam_reminder/preview')
      .set(auth)
      .expect(200)
      .expect('Content-Type', /text\/html/);
    expect(preview.text).toContain('Backend Engineer Mock Interview');
    await http()
      .get('/api/v1/admin/mail/templates/nope/preview')
      .set(auth)
      .expect(404);
    await http().get('/api/v1/admin/mail').expect(401);
  });
});
