import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/database/redis.service.js';
import {
  MAIL_QUEUE,
  type MailJob,
} from '../../src/modules/mail/models/mail.model.js';
import { MAIL_TRANSPORT } from '../../src/modules/mail/services/mail-transport.js';
import { MailProcessor } from '../../src/modules/mail/services/mail.processor.js';
import { MailService } from '../../src/modules/mail/services/mail.service.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { CapturingTransport, FakeQueue } from './fake-mail.js';
import { FakeRedis } from './fake-redis.js';
import { FakeStorage } from './fake-storage.js';

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  storage: FakeStorage;
  queue: FakeQueue;
  transport: CapturingTransport;
  /** Runs queued mail through the real MailProcessor, then returns the latest code sent to `to`. */
  lastCode: (to: string) => Promise<string>;
}

/**
 * Boots the full AppModule with infrastructure faked in memory: Redis,
 * S3 storage, the BullMQ mail queue and the SMTP transport. Pass a real
 * PrismaService for DB-backed suites (or a mock for DB-less ones).
 */
export async function createTestApp(
  overrides: { prisma?: unknown; redis?: unknown } = {},
): Promise<TestApp> {
  const storage = new FakeStorage();
  const queue = new FakeQueue();
  const transport = new CapturingTransport();

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService)
    .useValue(overrides.redis ?? new FakeRedis())
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(getQueueToken(MAIL_QUEUE))
    .useValue(queue)
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(transport);
  if (overrides.prisma) {
    builder = builder
      .overrideProvider(PrismaService)
      .useValue(overrides.prisma);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<INestApplication>();
  configureApp(app);
  await app.init();

  // MAIL_WORKER_ENABLED=false in e2e, so wire the real processor to the fake queue.
  const processor = new MailProcessor(
    moduleRef.get(PrismaService),
    moduleRef.get(MailService),
    transport,
  );
  queue.useProcessor((job) =>
    processor.process(job as unknown as Job<MailJob>),
  );

  return {
    app,
    moduleRef,
    storage,
    queue,
    transport,
    lastCode: async (to) => {
      await queue.drain();
      return transport.lastCode(to);
    },
  };
}
