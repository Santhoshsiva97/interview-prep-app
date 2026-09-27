// Local smoke-test launcher: compiled backend + real Postgres (prisma dev) +
// in-memory Redis fake + in-process stand-in for the BullMQ `mail` queue
// (this machine has no Redis). Mail goes through the real MailProcessor and
// real Nodemailer SMTP transport. DEV ONLY. See tools/local-dev/README.md.
// Run with cwd = backend/ after `npm run build`.
import { fileURLToPath, pathToFileURL } from 'node:url';

// Paths resolve from this file: tools/local-dev → ../../backend/
const B = fileURLToPath(new URL("../../backend/", import.meta.url));
const imp = (p) => import(pathToFileURL(B + p).href);

process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:51214/template1?sslmode=disable';
process.env.MAIL_WORKER_ENABLED = 'false'; // no BullMQ Worker without Redis

const { Test } = await imp('node_modules/@nestjs/testing/index.js');
const { ConsoleLogger } = await imp('node_modules/@nestjs/common/index.js');
const { getQueueToken } = await imp('node_modules/@nestjs/bullmq/dist/index.js');
const { AppModule } = await imp('dist/app.module.js');
const { configureApp } = await imp('dist/app.setup.js');
const { RedisService } = await imp('dist/database/redis.service.js');
const { PrismaService } = await imp('dist/database/prisma.service.js');
const { MailService } = await imp('dist/modules/mail/services/mail.service.js');
const { MailProcessor } = await imp('dist/modules/mail/services/mail.processor.js');
const { MAIL_TRANSPORT } = await imp('dist/modules/mail/services/mail-transport.js');
const { FakeRedis } = await imp('test/utils/fake-redis.ts');

/** Runs jobs shortly after `add`, retrying with real exponential backoff. */
class InlineQueue {
  add(_name, data, opts) {
    const run = async (attemptsMade) => {
      try {
        await this.processor.process({ data, opts, attemptsMade });
      } catch {
        if (attemptsMade + 1 < (opts.attempts ?? 1)) {
          const delay = opts.backoff.delay * 2 ** attemptsMade;
          console.log(`[InlineQueue] retrying ${opts.jobId} in ${delay}ms`);
          setTimeout(() => void run(attemptsMade + 1), delay);
        }
      }
    };
    setTimeout(() => void run(0), 50);
    return Promise.resolve({ id: opts.jobId });
  }
}
const queue = new InlineQueue();

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(RedisService)
  .useValue(new FakeRedis())
  .overrideProvider(getQueueToken('mail'))
  .useValue(queue)
  .compile();
const app = moduleRef.createNestApplication({ logger: new ConsoleLogger() });
configureApp(app);
await app.listen(3000);
queue.processor = new MailProcessor(
  moduleRef.get(PrismaService),
  moduleRef.get(MailService),
  moduleRef.get(MAIL_TRANSPORT),
);
console.log('SMOKE SERVER LISTENING on :3000');
