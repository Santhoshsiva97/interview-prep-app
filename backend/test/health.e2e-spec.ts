import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/database/redis.service.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  const redis = { ping: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([]) })
      .overrideProvider(RedisService)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
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
