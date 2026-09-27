# Interview Prep Portal

An online interview-preparation & examination platform: MCQ + coding practice,
timed mock exams, virtual interviews, auto-scoring and analytics.

| Part        | Stack                                                    | Path        |
| ----------- | -------------------------------------------------------- | ----------- |
| Frontend    | React 19 + TypeScript, Vite, React Router                | `frontend/` |
| Backend API | NestJS (Node.js + TypeScript), served under `/api/v1`    | `backend/`  |
| Database    | PostgreSQL 17, schema + migrations managed with Prisma 7 | `db/`       |
| Cache/Queue | Redis 7 (BullMQ added in later modules)                  | —           |
| Files       | S3-compatible storage (MinIO locally, S3/R2 in prod)     | —           |

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for conventions and
[PROGRESS_LOG.md](PROGRESS_LOG.md) for what has been built so far.

## Prerequisites

- **Docker option:** Docker Desktop (Compose v2.24+)
- **Local option:** Node.js 24+, npm 11+, plus a PostgreSQL 17 and Redis 7 you
  can reach (the Compose file can run just those two for you)

## Option A — everything in Docker

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- API health: http://localhost:3000/api/v1/health
- MinIO console (uploaded avatars/resumes): http://localhost:9001 (minioadmin / minioadmin)

The backend container generates the Prisma client, applies pending migrations,
then starts in watch mode. Source folders are bind-mounted, so edits hot-reload.
To change DB credentials or host ports, copy `.env.example` to `.env` in the
repo root.

Stop with `docker compose down` (add `-v` to wipe the database volume).

## Option B — apps on the host, databases in Docker

```bash
# 1. Start Postgres, Redis and MinIO only
docker compose up -d postgres redis minio

# 2. Database tooling (Prisma CLI) — reads DATABASE_URL from backend/.env
cp backend/.env.example backend/.env
npm --prefix db install
npm --prefix db run generate          # writes the client to backend/src/generated/prisma
npm --prefix db run migrate:deploy

# 3. Backend
npm --prefix backend install
npm --prefix backend run start:dev    # http://localhost:3000/api/v1/health

# 4. Frontend (new terminal)
npm --prefix frontend install
npm --prefix frontend run dev         # http://localhost:5173, proxies /api -> :3000
```

## Common commands

| Task                             | Command                                              |
| -------------------------------- | ---------------------------------------------------- |
| Create a migration (dev)         | `npm --prefix db run migrate:dev -- --name <name>`   |
| Create migration without applying| `npm --prefix db run migrate:create -- --name <name>`|
| Apply migrations                 | `npm --prefix db run migrate:deploy`                 |
| Migration status                 | `npm --prefix db run migrate:status`                 |
| Regenerate Prisma client         | `npm --prefix db run generate`                       |
| Browse data                      | `npm --prefix db run studio`                         |
| Backend lint / test / e2e        | `npm --prefix backend run lint` · `test` · `test:e2e`|
| Frontend lint / build            | `npm --prefix frontend run lint` · `build`           |
| Format                           | `npm --prefix backend run format` · `npm --prefix frontend run format` |

### Dev notes

- **OTP codes** (sign-up verification, password reset) are printed to the backend log as
  `[DEV OTP] ...` until the Mail Module (Step 5) sends real email.
- **DB-backed e2e tests** run only when `E2E_DATABASE_URL` points at a migrated, throwaway database
  (they create and delete `@e2e.test` users):
  `E2E_DATABASE_URL=postgresql://prep:prep@localhost:5432/interview_prep npm --prefix backend run test:e2e`
- **No Docker?** `npx --prefix db prisma dev` starts a local Prisma Postgres and prints a
  `postgres://` URL you can use for `DATABASE_URL`/`E2E_DATABASE_URL`. You still need Redis to run the API.
  Caveats: it serves **one** database whatever name you connect to, and its shadow database
  doesn't reset. If `migrate dev` fails with "already exists", generate the SQL without a shadow DB.
  From `db/`: `npx prisma migrate diff --from-config-datasource --to-schema schema.prisma --script -o migrations/<timestamp>_<name>/migration.sql`
  (create the folder first), then `npm run migrate:deploy`.

In Docker, run DB commands inside the backend container, e.g.
`docker compose exec backend npm --prefix ../db run migrate:dev -- --name add_users`.

## Repository layout

```
frontend/   React app (Vite)
backend/    NestJS API
db/         Prisma schema (schema.prisma), config, and migrations/
docker-compose.yml
```

A more detailed layout lives in [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md#repo-structure).
