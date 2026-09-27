import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../database/redis.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const prisma = { $queryRaw: vi.fn() };
  const redis = { ping: vi.fn() };
  let service: HealthService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  it('reports ok when all dependencies respond', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('reports degraded when a dependency fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    redis.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ database: 'down', redis: 'up' });
  });
});
