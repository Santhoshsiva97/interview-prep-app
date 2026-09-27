import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../database/redis.service.js';
import type {
  DependencyStatus,
  HealthStatus,
} from '../models/health-status.model.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.prisma.$queryRaw`SELECT 1`),
      this.probe(() => this.redis.ping()),
    ]);

    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  private async probe(fn: () => Promise<unknown>): Promise<DependencyStatus> {
    try {
      await fn();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
