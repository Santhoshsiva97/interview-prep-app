import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// DATABASE_URL comes from the process env (Docker Compose sets it), falling
// back to backend/.env so there is a single source of truth for local dev.
loadEnv({ path: '../backend/.env', quiet: true });

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
