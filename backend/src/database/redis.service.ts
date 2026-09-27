import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { EnvVars } from '../config/env.validation.js';

/**
 * General-purpose Redis client (caching, OTP codes, rate limits).
 * BullMQ queues get their own connections (maxRetriesPerRequest: null) when
 * they are introduced.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService<EnvVars, true>) {
    super(config.get('REDIS_URL', { infer: true }), {
      // Fail fast instead of queueing commands while disconnected.
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    // Connection errors are surfaced via health checks; don't crash the process.
    this.on('error', () => undefined);
    void this.connect().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit().catch(() => this.disconnect());
  }
}
