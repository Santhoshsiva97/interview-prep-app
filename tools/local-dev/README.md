# Local dev without Docker

This machine has no Docker/Redis, so these helpers stand in for the Compose services
during manual testing. **Dev only.** With Docker, use `docker compose up` instead
(Postgres, Redis, MinIO and Mailpit are real there).

| Helper | Replaces | Run (from repo root) | URL |
|---|---|---|---|
| Prisma local Postgres | `postgres` service | `npx --prefix db prisma dev start interview-prep` | `postgres://postgres:postgres@localhost:51214/template1` |
| `mail-inbox.mjs` | Mailpit | `npm --prefix tools/local-dev install` (once), then `npm --prefix tools/local-dev run inbox` | SMTP `localhost:2525`, inbox http://localhost:8025 |
| `dev-server.mjs` | backend + Redis + BullMQ | see below | http://localhost:3000 |
| `db-viewer.cjs` | Prisma Studio (flaky on the local Postgres) | `npm --prefix tools/local-dev run db-viewer` | http://localhost:8088 (read-only) |
| Frontend | `frontend` service | `npm --prefix frontend run dev` | http://localhost:5173 |

## Backend launcher

Boots the **compiled** backend with an in-memory Redis fake (`backend/test/utils/fake-redis.ts`)
and an in-process stand-in for the BullMQ `mail` queue (same `MailProcessor`, same exponential
backoff). Mail is sent over real SMTP to the inbox above.

```bash
npm --prefix backend run build
```
```bash
cd backend && MAIL_TRANSPORT=smtp SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=apikey SMTP_PASS=dev node ../tools/local-dev/dev-server.mjs
```

Caveats:
- Redis state (OTP codes, cooldowns, revocations) is lost on restart.
- File uploads need an S3 endpoint. Either run an S3 emulator (e.g. `npx s3rver --directory ./s3data --port 9000 --configure-bucket interview-prep`, creds `S3RVER`/`S3RVER`) and add `S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY_ID=S3RVER S3_SECRET_ACCESS_KEY=S3RVER`, or skip avatar/resume testing.
- The Prisma local Postgres can't run concurrent queries, so an occasional 500 (`bind message supplies…`) is the database, not the app.
- Seed data: `npm --prefix backend run seed:dev`. First super admin: `npm --prefix backend run admin:promote -- <email>`.

## Exams (Step 7)

- Add `CODE_RUNNER=local` to the backend launch command to make **Run sample tests** execute JavaScript/Python
  locally (unsandboxed child processes, dev only). Without it, Run reports that code execution is unavailable.
- To test as another user without signing out of your own session, open the app on a different loopback host,
  e.g. `http://exam.localhost:5173` (separate cookies). Local test-account credentials, if created, live in the
  gitignored `tools/local-dev/.env.test-accounts`.
- If e2e tests start failing with `Server has closed the connection`, restart the dev database:
  `npx --prefix db prisma dev stop interview-prep`, then start it again.
