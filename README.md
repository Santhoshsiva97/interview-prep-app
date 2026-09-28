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
- Mailpit inbox (every email the app sends, including OTP codes): http://localhost:8025

The backend container generates the Prisma client, applies pending migrations,
then starts in watch mode. Source folders are bind-mounted, so edits hot-reload.
To change DB credentials or host ports, copy `.env.example` to `.env` in the
repo root.

Stop with `docker compose down` (add `-v` to wipe the database volume).

## Option B — apps on the host, databases in Docker

```bash
# 1. Start Postgres, Redis, MinIO and Mailpit only
docker compose up -d postgres redis minio mailpit

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

### Email

Outbound mail is queued with BullMQ (Redis) and sent over SMTP by a background worker.
Set these in `backend/.env` (see `backend/.env.example`):

| Provider | Settings |
|---|---|
| **SendGrid** (recommended) | `MAIL_TRANSPORT=smtp` · `SMTP_HOST=smtp.sendgrid.net` · `SMTP_PORT=587` · `SMTP_USER=apikey` · `SMTP_PASS=<SendGrid API key>` |
| **AWS SES** | `MAIL_TRANSPORT=smtp` · `SMTP_HOST=email-smtp.<region>.amazonaws.com` · `SMTP_PORT=587` · `SMTP_USER` / `SMTP_PASS` = SES *SMTP* credentials (not IAM keys) |
| Local (Docker) | preconfigured: Mailpit on `mailpit:1025`, inbox at http://localhost:8025 |
| Local (no Docker) | `MAIL_TRANSPORT=log` prints each email, including codes, to the backend log |

Always set `MAIL_FROM` to a sender you've verified with the provider (e.g. `InterviewPrep <no-reply@yourdomain.com>`),
and `APP_BASE_URL` to the public web URL used in email links. Staff can check delivery status under
**Admin → Email**.

### Code judge

Candidate code ("Run" and grading) goes through the `judge` BullMQ queue to the runner picked by `CODE_RUNNER`:

| `CODE_RUNNER` | What runs code | Languages | Use |
|---|---|---|---|
| `judge0` | [Judge0 CE](https://github.com/judge0/judge0) 1.13 (isolate sandboxes: CPU/wall/memory limits, no network) | Python 3, JavaScript (Node), Java, C++ | production, full local stack |
| `local` | plain child processes, **not sandboxed** | JavaScript, Python | dev only (refused in production) |
| `disabled` (default) | nothing | none (coding answers can't be graded; MCQs are) | |

Local Judge0: `docker compose --profile judge up --build` and set `CODE_RUNNER=judge0` in the root `.env`. The token in
`tools/judge0/judge0.conf` (`AUTHN_TOKEN`) must match `JUDGE0_AUTH_TOKEN`. Judge0 1.13 needs **privileged containers and
cgroup v1**. On cgroup-v2 hosts (recent Docker Desktop, Ubuntu 22.04+), boot with `systemd.unified_cgroup_hierarchy=0`,
or run Judge0 on a separate VM and point `JUDGE0_URL` at it. Java answers must declare `public class Main`.

### Dev notes

- **Sample data:** `npm --prefix backend run build && npm --prefix backend run seed:dev` loads 10 topics,
  16 tags and 12 published questions (8 MCQ, 4 coding) from `db/seed/questions.sample.json`. Safe to re-run.
  In Docker: `docker compose exec backend npm run seed:dev`.
- **Bulk question upload format:** see [docs/question-import-format.md](docs/question-import-format.md).
- **First super admin:** sign up and verify an account, then run
  `npm --prefix backend run build && npm --prefix backend run admin:promote -- you@example.com`
  (in Docker: `docker compose exec backend npm run admin:promote -- you@example.com`). Log in
  again and you land in the admin console at `/admin`. Other staff are created from **Admin → Staff & Roles**.

- **OTP codes** arrive by email. Locally, read them in Mailpit (Docker) or, with `MAIL_TRANSPORT=log`,
  in the backend log as `[DEV MAIL] ...`.
- **DB-backed e2e tests** run only when `E2E_DATABASE_URL` points at a migrated, throwaway database
  (they create and delete `@e2e.test` users):
  `E2E_DATABASE_URL=postgresql://prep:prep@localhost:5432/interview_prep npm --prefix backend run test:e2e`
- **No Docker?** `npx --prefix db prisma dev` starts a local Prisma Postgres and prints a
  `postgres://` URL you can use for `DATABASE_URL`/`E2E_DATABASE_URL`. You still need Redis to run the API.
  Caveats: it serves **one** database whatever name you connect to, and its shadow database
  doesn't reset. If `migrate dev` fails with "already exists", generate the SQL without a shadow DB.
  From `db/`: `npx prisma migrate diff --from-config-datasource --to-schema schema.prisma --script -o migrations/<timestamp>_<name>/migration.sql`
  (create the folder first), then `npm run migrate:deploy`.
  It also can't run two queries at once, so an occasional 500 with `bind message supplies N parameters`
  is this server, not the app. Real Postgres (Docker) doesn't have the problem.

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
