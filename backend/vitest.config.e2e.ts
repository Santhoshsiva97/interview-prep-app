import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Suites share one database; run files sequentially.
    fileParallelism: false,
    // Satisfy env validation; Prisma/Redis are mocked in e2e tests.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-0000',
      S3_AUTO_CREATE_BUCKET: 'false',
      MAIL_TRANSPORT: 'log',
      MAIL_WORKER_ENABLED: 'false',
    },
  },
});
