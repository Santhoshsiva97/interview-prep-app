# Progress Log

(Each completed module appends a dated entry below. Newest entries at the bottom.)

---

## 2026-09-27 — Step 0: Project Scaffolding ✅

**Decisions**
- Backend framework: **NestJS 12**. Its module/DI structure maps one-to-one to the FRD's
  ~20 modules and ships guards (RBAC), BullMQ and config integrations.
- Migration tool / ORM: **Prisma 7.10** (pinned; `latest` on npm was an 8.0 RC). Schema at
  `db/schema.prisma`, migrations at `db/migrations/`, client generated into
  `backend/src/generated/prisma/` and used through the `@prisma/adapter-pg` driver adapter.
- Linting: both scaffolders now default to oxlint; replaced with **ESLint 10 (flat config) +
  Prettier** as requested. TypeScript pinned to ~6.0 because typescript-eslint doesn't support TS 7 yet.

**What exists**
- `frontend/`: Vite 8 + React 19 + TS; React Router data router with `AppLayout` (sticky header
  nav, responsive at phone width, footer, light/dark tokens). Routes: `/` (home + live API
  status indicator), placeholders `/practice`, `/exams`, `/interviews`, `/pricing`, `/login`,
  `/signup`, plus 404 and a route error boundary. `apiFetch` wrapper; Vite dev proxy `/api` → backend.
- `backend/`: NestJS 12 (ESM). `/api` prefix + URI versioning (default v1). Joi-validated env
  (`NODE_ENV, PORT, DATABASE_URL, REDIS_URL, CORS_ORIGINS`). Global `DatabaseModule` with
  `PrismaService` and `RedisService` (ioredis, fail-fast). `HealthModule` →
  `GET /api/v1/health` (200 when Postgres + Redis are up, 503 with per-dependency status otherwise).
  Folder convention `modules/<feature>/{controllers,services,models}`.
- `db/`: standalone npm package with Prisma CLI, `prisma.config.ts`, empty schema (generator +
  datasource only), and empty baseline migration `20260927000000_init`.
- `docker-compose.yml`: postgres:17, redis:7 (both with healthchecks + volumes), backend
  (generates client → `migrate deploy` → `start:dev`), frontend (Vite, polling watch).
- Root: README (Docker and host setup), `.gitignore`, `.gitattributes` (LF), `.editorconfig`,
  `.env.example`. `git init` done; nothing committed yet.

**Verified**
- Backend: `lint`, `build`, unit tests (2) and e2e tests (2) pass; compiled app boots and serves
  `/api/v1/health` (returned 503 with no DB/Redis running, as expected).
- Frontend: `lint`, `format:check`, `build` pass; checked in the browser: nav, routing, 404, mobile
  layout, and the health call through the Vite proxy.
- `prisma validate` and `prisma generate` pass.
- **Not verified:** Docker isn't installed on the dev machine, so `docker compose up` and
  `migrate deploy` against a real Postgres haven't run yet. Run these first in Step 1.

**Notes for next steps**
- Step 1 adds models to `db/schema.prisma` following the conventions in PROJECT_CONTEXT.md, then
  `npm --prefix db run migrate:dev -- --name <name>`.
- New env vars → `backend/src/config/env.validation.ts` + `backend/.env.example`.
- BullMQ is not installed yet; add `@nestjs/bullmq` + `bullmq` with a dedicated connection
  (`maxRetriesPerRequest: null`) when the first queue is needed (Mail, Step 5).

---

## 2026-09-27 — Step 2: Registration & Login (FRD §4.1) ✅

**Built ahead of Step 1.** There were no tables yet, so this step added a minimal Identity schema
(migration `20260927104502_auth_identity`): `users` (enums `user_role`, `user_status`; lockout
columns `failed_login_attempts`, `locked_until`; nullable `password_hash` and `google_id` for social
login) and `refresh_tokens` (hashed token, `family_id` for rotation, `revoked_at`,
`replaced_by_id`). **Step 1 must reconcile these with the Database Module Design Document** and
keep the column semantics the auth code relies on. The FRD wasn't attached, so code comments cite
"FRD §4.1" rather than individual FR-1.x numbers. Add those tags once the FRD is available.

**Endpoints** (all under `/api/v1/auth`, public unless noted)
| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | name, email, phone (E.164), password → creates `pending_verification` user, sends OTP. 409 `EMAIL_TAKEN` if verified account exists; re-registering an unverified email overwrites it |
| POST | `/verify-email` | email + 6-digit code → activates account, returns access token, sets refresh cookie |
| POST | `/verify-email/resend` | resends verification OTP (202; 429 `OTP_COOLDOWN` with `retryAfterSeconds`) |
| POST | `/login` | returns `{ accessToken, expiresIn, user }` + HttpOnly refresh cookie. 401 `INVALID_CREDENTIALS`, 403 `EMAIL_NOT_VERIFIED` / `ACCOUNT_SUSPENDED`, 423 `ACCOUNT_LOCKED` (+ `lockedUntil`) |
| POST | `/refresh` | rotates the refresh cookie, returns a new access token |
| POST | `/logout` | revokes the refresh token, clears the cookie (204) |
| POST | `/forgot-password` | always 202 (no account enumeration); sends reset OTP if the account exists |
| POST | `/reset-password` | email + code + newPassword → sets password, clears lockout, revokes all sessions |
| GET | `/me` | **auth required**: current user profile |
| GET | `/google`, `/google/callback` | **Deferred:** return 501 `NOT_IMPLEMENTED`. Routes reserved; `users.google_id` already exists |

**Behaviour**
- Passwords: argon2id (`@node-rs/argon2`, 19 MiB / t=2). Policy: 8–128 chars, at least one letter and one digit.
  Unknown emails still run a dummy hash so response timing doesn't reveal accounts.
- OTP (`modules/auth/services/otp.service.ts`): 6 digits, stored in Redis as SHA-256. TTL 10 min, max
  5 wrong attempts (then the code is burned), 60 s resend cooldown. Codes are separate per purpose
  (`verify_email`, `reset_password`). All values are configurable via env.
- Lockout: the 5th consecutive wrong password locks the account for 15 min (`AUTH_LOCKOUT_MINUTES`).
  Locked accounts are rejected before the password is checked. A successful login or password reset clears it.
- Tokens: HS256 access JWT (15 min, `{ sub, role }`). The refresh token is opaque, 30 days, stored
  hashed and rotated on each use. Reusing a rotated-out token revokes the whole family, with a 10 s
  grace window for multi-tab races.
- New env vars: `JWT_ACCESS_SECRET` (required, ≥32 chars), `JWT_ACCESS_TTL_SECONDS`,
  `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`,
  `OTP_RESEND_COOLDOWN_SECONDS`, `AUTH_MAX_FAILED_LOGINS`, `AUTH_LOCKOUT_MINUTES`.

**Auth middleware location** (Nest guards, registered globally in `backend/src/app.module.ts`)
- `backend/src/common/guards/jwt-auth.guard.ts`: requires a Bearer token on every route unless `@Public()`
- `backend/src/common/guards/roles.guard.ts`: enforces `@Roles(...)`; `super_admin` always passes
- Decorators in `backend/src/common/decorators/`: `@Public()`, `@Roles()`, `@CurrentUser()`

**OTP email stub (Step 5 wiring point)**
- Interface + stub: `backend/src/modules/auth/services/otp-sender.ts`. `OtpSender.send({ email,
  code, purpose, expiresInSeconds })`; `ConsoleOtpSender` logs `[DEV OTP] ...` (and refuses to log
  codes when `NODE_ENV=production`).
- Binding: `backend/src/modules/auth/auth.module.ts`, `{ provide: OTP_SENDER, useClass:
  ConsoleOtpSender }` (marked `STEP 5 HOOK`). Step 5 swaps in a BullMQ-backed email sender here.
  No other auth code changes.

**Frontend**
- Screens: `/signup`, `/verify-email` (resend with countdown), `/login` (unverified → sends a code
  and redirects to verify; lockout message), `/forgot-password` (request code → reset in two steps), and
  a minimal protected `/account` page (placeholder until the Step 3 dashboard). The header shows the user and a Log out button.
- `features/auth/AuthProvider` restores the session from the refresh cookie on load. The access token
  is in memory only, and `apiFetch` refreshes once on 401 (single-flight, safe under StrictMode).
- `<RequireAuth roles={[...]}>` is available for Step 3/4 protected routes.

**Verified**
- Backend lint/build pass. 19 unit tests: OTP TTL, attempts, cooldown, purpose isolation;
  lockout; RBAC guard. 7 e2e tests run against a **real Postgres** (Prisma local dev server) with
  faked Redis: full sign-up → verify → me → rotation → logout, family revocation on token reuse,
  lockout → reset → unlock, no enumeration on forgot-password, duplicate/validation/Google-501.
- Both migrations applied cleanly to that Postgres.
- Browser walkthrough (phone width): sign-up → login while unverified → auto-resend → wrong
  code → right code → account page → reload keeps session (one refresh call) → logout →
  `/account` redirects to login → 5 bad logins show the lock message → forgot/reset → login.
- **Still not verified:** real Redis and `docker compose up` (Docker isn't installed on this machine).

**Notes for next steps**
- Step 1: reconcile `users`/`refresh_tokens` with the design doc; don't drop columns listed above.
- Step 3/4: protect routes with `<RequireAuth>` on the frontend and `@Roles(...)` on the API. Admin
  suspend/force-logout = set `users.status = 'suspended'` + `TokenService.revokeAllForUser()`
  (exported from `AuthModule`). Access tokens stay valid until they expire (≤15 min).
- Step 13 (rate limiting): login/OTP endpoints only have lockout + OTP cooldown so far.
  No per-IP throttling yet.
