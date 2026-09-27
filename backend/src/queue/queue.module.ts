import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'bullmq';
import type { EnvVars } from '../config/env.validation.js';

/** Converts REDIS_URL (redis:// or rediss://) into explicit connection options. */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

/**
 * Shared BullMQ connection for every queue. Workers need
 * `maxRetriesPerRequest: null` (blocking commands); producers override this
 * per queue to fail fast instead (see MailModule).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        connection: {
          ...redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
          maxRetriesPerRequest: null,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
