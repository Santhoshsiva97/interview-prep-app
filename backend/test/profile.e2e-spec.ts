/**
 * Client portal: profile + dashboard over HTTP against a real Postgres
 * (Redis and object storage are faked in-memory). Runs only with E2E_DATABASE_URL.
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
import { StorageService } from '../src/storage/storage.service.js';
import { FakeRedis } from './utils/fake-redis.js';
import { FakeStorage } from './utils/fake-storage.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const EMAIL = 'profile@e2e-portal.test';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const PDF = Buffer.from('%PDF-1.7\n% test resume\n');

describe.skipIf(!DB_URL)('Client portal: profile & dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const storage = new FakeStorage();
  const outbox: OtpMessage[] = [];
  let token: string;

  const http = () => request(app.getHttpServer());
  const authed = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const cleanup = () =>
    prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-portal.test' } },
    });

  beforeAll(async () => {
    prisma = new PrismaService({
      get: () => DB_URL,
    } as unknown as ConfigService);
    await cleanup();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(new FakeRedis())
      .overrideProvider(StorageService)
      .useValue(storage)
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
      .send({ email: EMAIL, code: outbox[outbox.length - 1].code })
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
    const firstKey = [...storage.objects.keys()].find((k) =>
      k.includes('/avatar/'),
    )!;

    await authed(http().put('/api/v1/me/avatar'))
      .attach('file', PNG, { filename: 'me2.png', contentType: 'image/png' })
      .expect(200);
    expect(storage.objects.has(firstKey)).toBe(false); // old object cleaned up

    await authed(http().delete('/api/v1/me/avatar'))
      .expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBeNull());
    expect(
      [...storage.objects.keys()].some((k) => k.includes('/avatar/')),
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
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.includes('/resume/'),
    )!;
    expect(stored[1].contentType).toBe('application/pdf');

    await authed(http().delete('/api/v1/me/resume'))
      .expect(200)
      .expect(({ body: b }) => expect(b.resume).toBeNull());
    expect(storage.objects.has(stored[0])).toBe(false);
  });

  it('serves the dashboard with live completeness and placeholder widgets', async () => {
    const { body } = await authed(http().get('/api/v1/dashboard')).expect(200);
    expect(body.user.name).toBe('Priya Sharma');
    expect(body.profileCompleteness.status).toBe('live');
    expect(body.profileCompleteness.data.percent).toBeGreaterThan(11);
    expect(body.streak).toEqual({ status: 'coming_soon', data: null });
    expect(body.recentActivity).toEqual({ status: 'coming_soon', data: [] });
    expect(body.recommendedTests).toEqual({ status: 'coming_soon', data: [] });
  });
});
