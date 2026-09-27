/**
 * Full auth flow over HTTP against a real Postgres. Redis, the mail queue and
 * SMTP are faked in-memory; OTP codes are read from the emails actually rendered
 * by the Mail Module.
 * Runs only when E2E_DATABASE_URL points at a migrated, disposable database:
 *   E2E_DATABASE_URL=postgres://... npm run test:e2e
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fakeConfig } from './utils/fake-config.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, type TestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e.test';

describe.skipIf(!DB_URL)('Auth (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: TestApp;

  const http = () => request(app.getHttpServer());
  const lastCode = (email: string) => t.lastCode(email);
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
      .send({ email, code: await lastCode(email) })
      .expect(200);
  };

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await prisma.mailMessage.deleteMany({
      where: { toAddress: { endsWith: DOMAIN } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

    t = await createTestApp({ prisma });
    app = t.app;
  });

  afterAll(async () => {
    await prisma?.mailMessage.deleteMany({
      where: { toAddress: { endsWith: DOMAIN } },
    });
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
        code: '000000' === (await lastCode(email)) ? '111111' : '000000',
      })
      .expect(400)
      .expect(({ body }) => expect(body.attemptsRemaining).toBe(4));

    const verified = await http()
      .post('/api/v1/auth/verify-email')
      .send({ email, code: await lastCode(email) })
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
        code: await lastCode(email),
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
    await t.queue.drain();
    const before = t.transport.sent.length;
    await http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody${DOMAIN}` })
      .expect(202);
    await t.queue.drain();
    expect(t.transport.sent.length).toBe(before);
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
