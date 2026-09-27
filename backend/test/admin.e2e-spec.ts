/**
 * Admin portal API against a real Postgres (Redis, storage, OTP faked).
 * Runs only with E2E_DATABASE_URL.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/database/redis.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import {
  OTP_SENDER,
  type OtpMessage,
} from '../src/modules/auth/services/otp-sender.js';
import { StorageService } from '../src/storage/storage.service.js';
import { FakeRedis } from './utils/fake-redis.js';
import { FakeStorage } from './utils/fake-storage.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-admin.test';
const PASSWORD = 'secret123';

interface Session {
  id: string;
  token: string;
  cookie: string;
}

describe.skipIf(!DB_URL)('Admin portal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const outbox: OtpMessage[] = [];
  const s: Record<string, Session> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${s[who].token}`);
  const cleanup = () =>
    prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const login = async (email: string, password = PASSWORD) => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password });
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
    return { res, token: res.body.accessToken as string, cookie };
  };

  /** Creates an active, verified account directly and logs it in. */
  const seed = async (key: string, role: UserRole, name = key) => {
    const email = `${key}${DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: '+919800000000',
        role,
        status: 'active',
        emailVerifiedAt: new Date(),
        passwordHash: await hash(PASSWORD),
      },
    });
    const { token, cookie } = await login(email);
    s[key] = { id: user.id, token, cookie };
  };

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
      .useValue(new FakeStorage())
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

    await seed('superadmin', 'super_admin', 'Root Admin');
    await seed('admin', 'admin', 'Ada Admin');
    await seed('support', 'support', 'Sam Support');
    await seed('editor', 'editor', 'Eve Editor');
    await seed('alice', 'candidate', 'Alice Candidate');
    await seed('bob', 'candidate', 'Bob Candidate');
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('keeps candidates out and lets each staff role see what it should', async () => {
    await as('alice', http().get('/api/v1/admin/dashboard')).expect(403);
    await as('alice', http().get('/api/v1/admin/users')).expect(403);

    for (const who of ['editor', 'support', 'admin', 'superadmin']) {
      await as(who, http().get('/api/v1/admin/dashboard')).expect(200);
    }
    await as('editor', http().get('/api/v1/admin/users')).expect(403);
    await as('support', http().get('/api/v1/admin/users')).expect(200);
    await as(
      'support',
      http().post(`/api/v1/admin/users/${s.alice.id}/suspend`),
    )
      .send({ reason: 'nope' })
      .expect(403);
  });

  it('dashboard: live user counts, placeholder KPIs', async () => {
    const { body } = await as(
      'admin',
      http().get('/api/v1/admin/dashboard'),
    ).expect(200);
    expect(body.users.status).toBe('live');
    expect(body.users.data.totalCandidates).toBeGreaterThanOrEqual(2);
    expect(body.users.data.staff).toBeGreaterThanOrEqual(4);
    expect(body.engagement).toEqual({
      status: 'coming_soon',
      data: { dau: null, mau: null },
    });
    expect(body.subscriptions.status).toBe('coming_soon');
    expect(body.testVolume.status).toBe('coming_soon');
  });

  it('searches, filters and paginates users', async () => {
    const byName = await as('support', http().get('/api/v1/admin/users'))
      .query({ search: 'alice cand' })
      .expect(200);
    expect(byName.body.items.map((u: { email: string }) => u.email)).toEqual([
      `alice${DOMAIN}`,
    ]);

    const byEmail = await as('admin', http().get('/api/v1/admin/users'))
      .query({ search: 'E2E-ADMIN.TEST', role: 'candidate', sort: 'name' })
      .expect(200);
    expect(byEmail.body.items.map((u: { name: string }) => u.name)).toEqual([
      'Alice Candidate',
      'Bob Candidate',
    ]);
    expect(byEmail.body.items[0].passwordHash).toBeUndefined();

    const page = await as('admin', http().get('/api/v1/admin/users'))
      .query({ search: DOMAIN, pageSize: 2, page: 2 })
      .expect(200);
    expect(page.body).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 6,
      totalPages: 3,
    });
    expect(page.body.items).toHaveLength(2);

    const staff = await as('admin', http().get('/api/v1/admin/users'))
      .query({ search: DOMAIN, scope: 'staff', sort: 'name' })
      .expect(200);
    expect(
      staff.body.items.map((u: { role: string }) => u.role).sort(),
    ).toEqual(['admin', 'editor', 'super_admin', 'support']);

    await as('admin', http().get('/api/v1/admin/users'))
      .query({ pageSize: 500 })
      .expect(400);
    await as('admin', http().get('/api/v1/admin/users/not-a-uuid')).expect(400);
  });

  it('shows a user profile with session count', async () => {
    const { body } = await as(
      'support',
      http().get(`/api/v1/admin/users/${s.alice.id}`),
    ).expect(200);
    expect(body).toMatchObject({
      email: `alice${DOMAIN}`,
      role: 'candidate',
      status: 'active',
      activeSessions: 1,
      hasPassword: true,
      suspension: null,
    });
    expect(body.profile).toBeDefined();
  });

  it('suspension ends sessions immediately and blocks login until reactivated', async () => {
    // Alice's current access token works…
    await as('alice', http().get('/api/v1/me/profile')).expect(200);

    await as('admin', http().post(`/api/v1/admin/users/${s.alice.id}/suspend`))
      .send({ reason: '' })
      .expect(400);
    const suspended = await as(
      'admin',
      http().post(`/api/v1/admin/users/${s.alice.id}/suspend`),
    )
      .send({ reason: 'Sharing exam questions publicly' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      activeSessions: 0,
      suspension: {
        reason: 'Sharing exam questions publicly',
        by: { name: 'Ada Admin' },
      },
    });

    // …and stops working the moment she's suspended (not 15 min later).
    await as('alice', http().get('/api/v1/me/profile')).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.alice.cookie)
      .expect(401);
    const blocked = await login(`alice${DOMAIN}`);
    expect(blocked.res.status).toBe(403);
    expect(blocked.res.body.code).toBe('ACCOUNT_SUSPENDED');

    await as('admin', http().post(`/api/v1/admin/users/${s.alice.id}/suspend`))
      .send({ reason: 'again' })
      .expect(409);

    const reactivated = await as(
      'admin',
      http().post(`/api/v1/admin/users/${s.alice.id}/reactivate`),
    ).expect(200);
    expect(reactivated.body).toMatchObject({
      status: 'active',
      suspension: null,
    });
    const again = await login(`alice${DOMAIN}`);
    expect(again.res.status).toBe(200);
    s.alice = { ...s.alice, token: again.token, cookie: again.cookie };
  });

  it('force-logout revokes every session at once but allows logging back in', async () => {
    const second = await login(`bob${DOMAIN}`); // bob now has two sessions
    const { body } = await as(
      'admin',
      http().post(`/api/v1/admin/users/${s.bob.id}/force-logout`),
    ).expect(200);
    expect(body.revokedSessions).toBe(2);

    await as('bob', http().get('/api/v1/me/profile')).expect(401);
    await http()
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', second.cookie)
      .expect(401);
    expect((await login(`bob${DOMAIN}`)).res.status).toBe(200);
  });

  it('protects staff, super admins and the acting user', async () => {
    const cases: [string, string, string][] = [
      ['admin', s.admin.id, 'CANNOT_MANAGE_SELF'],
      ['admin', s.editor.id, 'STAFF_REQUIRES_SUPER_ADMIN'],
      ['admin', s.superadmin.id, 'CANNOT_MANAGE_SUPER_ADMIN'],
      ['superadmin', s.superadmin.id, 'CANNOT_MANAGE_SELF'],
    ];
    for (const [actor, target, code] of cases) {
      await as(actor, http().post(`/api/v1/admin/users/${target}/force-logout`))
        .expect(403)
        .expect(({ body: b }) => expect(b.code).toBe(code));
    }
    // A super admin can manage other staff.
    await as(
      'superadmin',
      http().post(`/api/v1/admin/users/${s.editor.id}/force-logout`),
    ).expect(200);
  });

  it('role changes are super-admin only and take effect immediately', async () => {
    await as('admin', http().patch(`/api/v1/admin/users/${s.bob.id}/role`))
      .send({ role: 'support' })
      .expect(403);
    await as('superadmin', http().patch(`/api/v1/admin/users/${s.bob.id}/role`))
      .send({ role: 'super_admin' })
      .expect(400);

    const bob = await login(`bob${DOMAIN}`);
    const { body } = await as(
      'superadmin',
      http().patch(`/api/v1/admin/users/${s.bob.id}/role`),
    )
      .send({ role: 'support' })
      .expect(200);
    expect(body.role).toBe('support');

    // Old token (role=candidate) is dead; a fresh login carries the new role.
    await http()
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(401);
    const relogged = await login(`bob${DOMAIN}`);
    expect(relogged.res.body.user.role).toBe('support');
    await http()
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${relogged.token}`)
      .expect(200);
  });

  it('super admin creates a staff account that is set up via the reset-code flow', async () => {
    const email = `new.editor${DOMAIN}`;
    await as('admin', http().post('/api/v1/admin/staff'))
      .send({ name: 'New Editor', email, role: 'editor' })
      .expect(403);
    await as('superadmin', http().post('/api/v1/admin/staff'))
      .send({ name: 'Bad', email: `x${DOMAIN}`, role: 'super_admin' })
      .expect(400);

    const created = await as('superadmin', http().post('/api/v1/admin/staff'))
      .send({
        name: 'New Editor',
        email: ' New.Editor@E2E-admin.test ',
        role: 'editor',
      })
      .expect(201);
    expect(created.body.user).toMatchObject({
      email,
      role: 'editor',
      status: 'pending_verification',
    });

    await as('superadmin', http().post('/api/v1/admin/staff'))
      .send({ name: 'Dup', email, role: 'support' })
      .expect(409)
      .expect(({ body: b }) => expect(b.code).toBe('EMAIL_TAKEN'));

    // No password yet → can't log in.
    expect((await login(email)).res.status).toBe(401);

    const code = outbox
      .filter((m) => m.email === email && m.purpose === 'reset_password')
      .pop()!.code;
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ email, code, newPassword: 'editor-pass1' })
      .expect(200);
    const first = await login(email, 'editor-pass1');
    expect(first.res.status).toBe(200);
    expect(first.res.body.user).toMatchObject({
      role: 'editor',
      status: 'active',
    });
  });
});
