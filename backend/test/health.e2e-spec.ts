import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.js';

describe('Health (e2e)', () => {
  let app: INestApplication;
  const redis = { ping: vi.fn() };

  beforeAll(async () => {
    ({ app } = await createTestApp({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([]) },
      redis,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 when dependencies are up', async () => {
    redis.ping.mockResolvedValue('PONG');
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /api/v1/health returns 503 when a dependency is down', async () => {
    redis.ping.mockRejectedValue(new Error('down'));
    await request(app.getHttpServer()).get('/api/v1/health').expect(503);
  });
});
