/**
 * Client portal: profile + dashboard over HTTP against a real Postgres
 * (Redis and object storage are faked in-memory). Runs only with E2E_DATABASE_URL.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fakeConfig } from './utils/fake-config.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, type TestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const EMAIL = 'profile@e2e-portal.test';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const PDF = Buffer.from('%PDF-1.7\n% test resume\n');

describe.skipIf(!DB_URL)('Client portal: profile & dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: TestApp;
  let token: string;

  const http = () => request(app.getHttpServer());
  const authed = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const cleanup = () =>
    prisma.$transaction([
      prisma.mailMessage.deleteMany({
        where: { toAddress: { endsWith: '@e2e-portal.test' } },
      }),
      prisma.user.deleteMany({
        where: { email: { endsWith: '@e2e-portal.test' } },
      }),
    ]);

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();

    t = await createTestApp({ prisma });
    app = t.app;

    await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Priya',
        email: EMAIL,
        phone: '+919876543210',
        password: 'secret123',
      })
      .expect(201);
    const res = await http()
      .post('/api/v1/auth/verify-email')
      .send({ email: EMAIL, code: await t.lastCode(EMAIL) })
      .expect(200);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('requires authentication', async () => {
    await http().get('/api/v1/me/profile').expect(401);
    await http().get('/api/v1/dashboard').expect(401);
  });

  it('returns an empty profile for a new user', async () => {
    const { body } = await authed(http().get('/api/v1/me/profile')).expect(200);
    expect(body.user).toMatchObject({ name: 'Priya', email: EMAIL });
    expect(body.profile.headline).toBeNull();
    expect(body.avatarUrl).toBeNull();
    expect(body.resume).toBeNull();
    // Only the phone number (from sign-up) is filled in.
    expect(body.completeness.percent).toBe(11);
    expect(body.completeness.missing).toContain('Profile photo');
  });

  it('updates, clears and validates profile fields', async () => {
    const { body } = await authed(http().patch('/api/v1/me/profile'))
      .send({
        name: '  Priya Sharma ',
        headline: 'Backend engineer',
        targetRole: 'SDE II',
        experienceYears: 3,
        linkedinUrl: 'https://www.linkedin.com/in/priya',
      })
      .expect(200);
    expect(body.user.name).toBe('Priya Sharma');
    expect(body.profile).toMatchObject({
      headline: 'Backend engineer',
      targetRole: 'SDE II',
      experienceYears: 3,
    });

    // Blank clears an optional field; omitted fields are untouched.
    const cleared = await authed(http().patch('/api/v1/me/profile'))
      .send({ headline: '   ' })
      .expect(200);
    expect(cleared.body.profile.headline).toBeNull();
    expect(cleared.body.profile.targetRole).toBe('SDE II');

    await authed(http().patch('/api/v1/me/profile'))
      .send({ name: '' })
      .expect(400);
    await authed(http().patch('/api/v1/me/profile'))
      .send({ linkedinUrl: 'https://evil.example.com/in/priya' })
      .expect(400);
    await authed(http().patch('/api/v1/me/profile'))
      .send({ experienceYears: 99 })
      .expect(400);
    // Email can't be changed here.
    await authed(http().patch('/api/v1/me/profile'))
      .send({ email: 'other@e2e-portal.test' })
      .expect(400);
  });

  it('uploads, replaces and removes the avatar', async () => {
    const first = await authed(http().put('/api/v1/me/avatar'))
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(200);
    expect(first.body.avatarUrl).toMatch(
      /^https:\/\/storage\.test\/users\/.+\/avatar\/.+\.png$/,
    );
    const firstKey = [...t.storage.objects.keys()].find((k) =>
      k.includes('/avatar/'),
    )!;

    await authed(http().put('/api/v1/me/avatar'))
      .attach('file', PNG, { filename: 'me2.png', contentType: 'image/png' })
      .expect(200);
    expect(t.storage.objects.has(firstKey)).toBe(false); // old object cleaned up

    await authed(http().delete('/api/v1/me/avatar'))
      .expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBeNull());
    expect(
      [...t.storage.objects.keys()].some((k) => k.includes('/avatar/')),
    ).toBe(false);
  });

  it('rejects bad avatar uploads', async () => {
    await authed(http().put('/api/v1/me/avatar'))
      .attach('file', Buffer.from('not an image'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('UNSUPPORTED_FILE_TYPE'));

    await authed(http().put('/api/v1/me/avatar'))
      .attach(
        'file',
        Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]),
        'big.png',
      )
      .expect(413)
      .expect(({ body }) => expect(body.code).toBe('FILE_TOO_LARGE'));

    await authed(http().put('/api/v1/me/avatar'))
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('FILE_REQUIRED'));
  });

  it('uploads and removes a resume with its original file name', async () => {
    const { body } = await authed(http().put('/api/v1/me/resume'))
      .attach('file', PDF, {
        filename: 'Priya Sharma CV.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);
    expect(body.resume).toMatchObject({
      fileName: 'Priya Sharma CV.pdf',
      sizeBytes: PDF.length,
    });
    expect(body.resume.url).toContain('download=Priya%20Sharma%20CV.pdf');
    const stored = [...t.storage.objects.entries()].find(([k]) =>
      k.includes('/resume/'),
    )!;
    expect(stored[1].contentType).toBe('application/pdf');

    await authed(http().delete('/api/v1/me/resume'))
      .expect(200)
      .expect(({ body: b }) => expect(b.resume).toBeNull());
    expect(t.storage.objects.has(stored[0])).toBe(false);
  });

  it('serves the dashboard with live completeness, activity and recommendations; streak placeholder', async () => {
    const { body } = await authed(http().get('/api/v1/dashboard')).expect(200);
    expect(body.user.name).toBe('Priya Sharma');
    expect(body.profileCompleteness.status).toBe('live');
    expect(body.profileCompleteness.data.percent).toBeGreaterThan(11);
    expect(body.streak).toEqual({ status: 'coming_soon', data: null });
    // Live since Step 9 (scorecards); this user hasn't taken any tests.
    expect(body.recentActivity).toEqual({ status: 'live', data: [] });
    // Live since Step 10: untaken published tests (whatever exists in the DB).
    expect(body.recommendedTests.status).toBe('live');
    expect(Array.isArray(body.recommendedTests.data)).toBe(true);
  });
});
