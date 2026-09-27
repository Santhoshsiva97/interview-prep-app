/**
 * Full auth flow over HTTP against a real Postgres (Redis is faked in-memory).
 * Runs only when E2E_DATABASE_URL points at a migrated, disposable database:
 *   E2E_DATABASE_URL=postgres://... npm run test:e2e
 */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/database/redis.service.js';
import {
  OTP_SENDER,
  type OtpMessage,
} from '../src/modules/auth/services/otp-sender.js';
import { FakeRedis } from './utils/fake-redis.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e.test';

describe.skipIf(!DB_URL)('Auth (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const outbox: OtpMessage[] = [];

  const http = () => request(app.getHttpServer());
  const lastCode = (email: string, purpose: OtpMessage['purpose']) =>
    [...outbox]
      .reverse()
      .find((m) => m.email === email && m.purpose === purpose)!.code;
  const refreshCookie = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('refresh_token='))!
      .split(';')[0];

  const registerAndVerify = async (email: string, password: string) => {
    await http()
      .post('/api/v1/auth/register')
      .send({ name: 'E2E User', email, phone: '+919876543210', password })
      .expect(201);
    return http()
      .post('/api/v1/auth/verify-email')
      .send({ email, code: lastCode(email, 'verify_email') })
      .expect(200);
  };

  beforeAll(async () => {
    prisma = new PrismaService({
      get: () => DB_URL,
    } as unknown as ConfigService);
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(new FakeRedis())
      .overrideProvider(OTP_SENDER)
      .useValue({
        send: (m: OtpMessage) => {
          outbox.push(m);
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app?.close();
  });

  it('sign-up → verify → me → refresh rotation → logout', async () => {
    const email = `flow${DOMAIN}`;

    await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Asha',
        email: 'FLOW@E2E.test',
        phone: '+919876543210',
        password: 'secret123',
      })
      .expect(201)
      .expect(({ body }) => expect(body.email).toBe(email));

    // Unverified users can't log in.
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));

    await http()
      .post('/api/v1/auth/verify-email')
      .send({
        email,
        code:
          '000000' === lastCode(email, 'verify_email') ? '111111' : '000000',
      })
      .expect(400)
      .expect(({ body }) => expect(body.attemptsRemaining).toBe(4));

    const verified = await http()
      .post('/api/v1/auth/verify-email')
      .send({ email, code: lastCode(email, 'verify_email') })
      .expect(200);
    expect(verified.body.user).toMatchObject({
      email,
      status: 'active',
      role: 'candidate',
    });
    expect(verified.body.user.passwordHash).toBeUndefined();
    const setCookie = String(verified.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    await http().get('/api/v1/auth/me').expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.email).toBe(email));

    // Rotation: the new cookie works, the old one doesn't.
    const cookie1 = refreshCookie(verified);
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(200);
    const cookie2 = refreshCookie(rotated);
    expect(cookie2).not.toBe(cookie1);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(401);
    const rotated2 = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .expect(200);
    const cookie3 = refreshCookie(rotated2);

    await http().post('/api/v1/auth/logout').set('Cookie', cookie3).expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie3)
      .expect(401);
  });

  it('reusing a rotated-out refresh token revokes the whole family', async () => {
    const email = `reuse${DOMAIN}`;
    const verified = await registerAndVerify(email, 'secret123');
    const cookie1 = refreshCookie(verified);
    const cookie2 = refreshCookie(
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie1)
        .expect(200),
    );

    // Pretend the rotation happened long ago (outside the multi-tab grace window).
    await prisma.refreshToken.updateMany({
      where: { user: { email }, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(401);
    // The attacker's reuse also killed the legitimate token.
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .expect(401);
  });

  it('locks after 5 failed logins; password reset unlocks and revokes sessions', async () => {
    const email = `lock${DOMAIN}`;
    const verified = await registerAndVerify(email, 'secret123');
    const sessionCookie = refreshCookie(verified);

    for (let i = 0; i < 4; i++) {
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-pass1' })
        .expect(401);
    }
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-pass1' })
      .expect(423)
      .expect(({ body }) => expect(body.lockedUntil).toBeDefined());
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(423);

    await http()
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(202);
    await http()
      .post('/api/v1/auth/reset-password')
      .send({
        email,
        code: lastCode(email, 'reset_password'),
        newPassword: 'newsecret456',
      })
      .expect(200);

    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', sessionCookie)
      .expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'newsecret456' })
      .expect(200);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const before = outbox.length;
    await http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody${DOMAIN}` })
      .expect(202);
    expect(outbox.length).toBe(before);
  });

  it('rejects duplicate sign-ups, bad input, and the deferred Google route', async () => {
    const email = `dup${DOMAIN}`;
    await registerAndVerify(email, 'secret123');
    await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Dup',
        email,
        phone: '+919876543210',
        password: 'secret123',
      })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_TAKEN'));

    await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'X',
        email: 'not-an-email',
        phone: '12345',
        password: 'short',
      })
      .expect(400);

    await http().get('/api/v1/auth/google').expect(501);
  });
});
