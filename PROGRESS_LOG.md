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

---

## 2026-09-27 — Step 3: Client Portal Shell (FRD §4.2) ✅

The FRD wasn't attached again, so code cites "FRD §4.2" rather than FR-2.x numbers.

**Page status — what later steps need to wire up**
| Route | Status | Wired by |
|---|---|---|
| `/dashboard` | **Functional** shell. The *Profile strength* widget is live; *Daily streak*, *Recent activity* and *Recommended tests* are placeholders (`status: 'coming_soon'`) | Streak → Step 17 · Activity → Steps 7–9 · Recommendations → Steps 6 + 10 |
| `/profile` | **Fully functional**: edit details, avatar upload/change/remove, resume upload/replace/remove/download | — |
| `/practice` | Placeholder (`ComingSoonPage`) | Step 6 (+ Step 19 search/filter) |
| `/history` | Placeholder | Step 9 (scorecards) |
| `/bookmarks` | Placeholder | Step 6 (bookmarking questions) |
| `/subscription` | Placeholder | Step 11 (payments) |
| `/account` | Redirects to `/profile` (Step 2's temporary page was removed) | — |

To make a placeholder real: replace its `ComingSoonPage` element in `frontend/src/app/router.tsx`
and drop `soon: true` from its entry in `frontend/src/components/layout/portalNav.ts`.
To turn on a dashboard widget: return `{ status: 'live', data }` for it from
`backend/src/modules/dashboard/services/dashboard.service.ts`. The frontend already renders live
data for every widget (types in `dashboard-response.model.ts`, mirrored in `frontend/src/features/dashboard/api.ts`).

**Backend endpoints** (all require auth)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/me/profile` | user + profile fields + presigned `avatarUrl` + `resume` {fileName, sizeBytes, uploadedAt, url} + `completeness` {percent, missing[]} |
| PATCH | `/api/v1/me/profile` | name, phone, headline, bio, location, targetRole, experienceYears (0–50), linkedinUrl/githubUrl (https, host-checked). Omitted = unchanged, blank/null = cleared. Name/phone can't be cleared, email isn't editable |
| PUT / DELETE | `/api/v1/me/avatar` | multipart `file`: JPEG/PNG/WebP ≤ 2 MB |
| PUT / DELETE | `/api/v1/me/resume` | multipart `file`: PDF/DOCX/DOC ≤ 5 MB. The original file name is kept for downloads |
| GET | `/api/v1/dashboard` | `{ user, profileCompleteness, streak, recentActivity, recommendedTests }`, each `{ status, data }` |

Upload errors use the shared coded-error shape: `FILE_REQUIRED` (400), `UNSUPPORTED_FILE_TYPE`
(400, checked by magic bytes, never the client MIME type), `FILE_TOO_LARGE` (413, enforced while streaming).

**Storage (S3-compatible)**
- `backend/src/storage/StorageService` (global): private bucket, presigned GET URLs (1 h), a separate
  signing endpoint for browsers (`S3_PUBLIC_ENDPOINT`), and the bucket is auto-created in dev.
  Keys: `users/<id>/avatar|resume/<uuid>.<ext>`. The old object is deleted when a file is replaced or removed.
- docker-compose gains **MinIO** (pinned `RELEASE.2025-04-22T22-12-26Z`, because MinIO stopped
  publishing community images). Console: http://localhost:9001.
- New env vars: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_AUTO_CREATE_BUCKET`, `S3_PRESIGNED_URL_TTL_SECONDS`.

**Schema:** migration `20260927120000_client_portal_profiles` adds `user_profiles` (1:1 with `users`,
created lazily): headline, bio, location, target_role, experience_years, linkedin_url, github_url,
avatar_key, resume_key/file_name/size_bytes/uploaded_at + audit columns. Step 1 should reconcile it
with the design document.

**Frontend structure**
- `PortalLayout` wraps every portal route in `RequireAuth` + `ProfileProvider`. Sidebar nav on
  desktop (>900px), an off-canvas drawer with a backdrop on tablet/phone (Escape closes it), and a top bar
  with `ProfileMenu` (avatar, name, Your profile / Subscription / Log out; closes on Escape or outside click).
- The public header shows a **Dashboard** button when signed in. Login and verify now land on `/dashboard`.
- Shared UI: `components/form` (moved from `features/auth/components/FormField`, plus `TextAreaField`),
  `components/icons/Icon`. Backend `AuthError` now extends the shared `common/errors/AppError`.

**Verified**
- Backend: lint/build pass. 24 unit tests, including file-type sniffing (disguised SVG/PDF rejected,
  DOCX needs a `.docx` name) and file-name sanitising. 14 e2e tests against real Postgres: auth
  (unchanged) plus a new profile/dashboard suite covering update/clear/validation, avatar replace
  cleanup, bad-file codes, resume name and content type, dashboard contract. E2E files now run
  sequentially (`fileParallelism: false`) because they share one database.
- Real S3 protocol, checked against the `s3rver` emulator: signed PUTs, presigned GET returns the same bytes, and the
  resume downloads with `Content-Disposition: attachment; filename="My CV (final).pdf"`.
- Browser, at 1024px and 375px: dashboard widgets, profile edit (0 → 100% complete), avatar upload through
  the real file input updates the page and the top-bar avatar and name, drawer and profile menu, placeholder
  pages, `/account` redirect, no horizontal overflow, and logging out makes portal routes redirect to login.
- **Still not verified:** MinIO itself and `docker compose up` (no Docker on this machine).

**Notes for next steps**
- Step 4 (admin): reuse `PortalLayout`'s pattern with an admin nav, gated by `<RequireAuth roles={['admin', …]}>`
  on the frontend and `@Roles(...)` on the API.
- Step 11: `/subscription` placeholder. Step 12 ads must never go on `/profile` form flows or on exam routes.
- Orphaned objects are possible if a DB write fails after an upload. A periodic sweep can be added
  with BullMQ later.

---

## 2026-09-27 — Step 4: Admin Portal Shell (FRD §4.3) ✅

Branch `step-4-admin-portal` (on top of `step-3-client-portal`). The FRD still wasn't attached,
so code cites "FRD §4.3" rather than FR-3.x numbers.

**Admin page status**
| Route | Status | Who sees it | Wired by |
|---|---|---|---|
| `/admin` | **Functional**. Live user KPIs (candidates, active/unverified, sign-ups 7/30 d, suspended, staff). DAU/MAU, active subscriptions, revenue and tests-taken are placeholders (`status: 'coming_soon'`) | all staff | Step 10 (engagement, tests), Step 11 (subscriptions, revenue) |
| `/admin/users` | **Fully functional**: search (name/email/phone), role/status filters, sort, pagination, filters kept in the URL, table becomes cards on phones | admin, support | — |
| `/admin/users/:id` | **Fully functional**: account facts, profile + resume, suspension banner; suspend (reason required) / reactivate / force-logout (admin); change role (super admin) | admin, support (read-only for support) | — |
| `/admin/staff` | **Fully functional**: create editor/support/admin accounts + team list | super admin | — |
| `/admin/exams` | Placeholder | admin, editor | Step 7 |
| `/admin/plans` | Placeholder | admin | Step 11 |
| `/admin/transactions` | Placeholder | admin, support | Step 11 |
| `/admin/ads` | Placeholder | admin | Step 12 |
| `/admin/audit-log` | Placeholder | admin | Step 13 |

To make a placeholder real: swap its `ComingSoonPage` in `frontend/src/app/router.tsx` and drop
`soon: true` from `ADMIN_NAV` in `frontend/src/components/layout/portalNav.ts` (keep `roles` in sync
with the API's `@Roles()`). To make a KPI live: return `{ status: 'live', data }` from
`backend/src/modules/admin/services/admin-dashboard.service.ts`.

**Backend endpoints** (`/api/v1/admin/...`)
| Method | Path | Roles |
|---|---|---|
| GET | `/dashboard` | editor, support, admin |
| GET | `/users?search&role&status&scope=all\|staff\|candidates&sort=newest\|oldest\|name\|last_login&page&pageSize≤100` | admin, support |
| GET | `/users/:id` (profile, presigned avatar/resume, active session count, suspension info) | admin, support |
| POST | `/users/:id/suspend` `{ reason }` · `/users/:id/reactivate` · `/users/:id/force-logout` | admin |
| PATCH | `/users/:id/role` `{ role: candidate\|editor\|support\|admin }` | super_admin |
| POST | `/staff` `{ name, email, phone?, role: editor\|support\|admin }` | super_admin |
(super_admin passes every role check.) Error codes: `USER_NOT_FOUND`, `CANNOT_MANAGE_SELF`,
`CANNOT_MANAGE_SUPER_ADMIN`, `STAFF_REQUIRES_SUPER_ADMIN`, `ALREADY_SUSPENDED`, `NOT_SUSPENDED`, `EMAIL_TAKEN`.

**Rules and design decisions**
- **Who can manage whom:** admins manage candidates only. Only a super admin can act on staff
  accounts. Nobody can act on their own account or on a super_admin. `super_admin` can't be assigned
  through the API: bootstrap it with the CLI `npm --prefix backend run admin:promote -- <email>`.
- **Force-logout is immediate** (it used to be "within 15 min"). `TokenService.revokeAllForUser` now
  also writes a per-user revocation timestamp to Redis (`SessionRevocationService`), and
  `JwtAuthGuard` rejects older access tokens. Access tokens now carry `iatMs`, because the standard
  `iat` has 1-second resolution and a token minted in the same second slipped through. The e2e
  tests caught this. Suspension, role changes and password resets get the same immediate effect.
  The check fails open if Redis is down; refresh tokens are still revoked in Postgres.
- **Staff onboarding without passwords:** creating staff makes a passwordless `pending_verification`
  account and sends a `reset_password` OTP. The new staff member sets a password on the normal
  "Forgot password" screen, which also verifies the email. Nobody handles someone else's password.
- **Schema:** migration `20260927133000_admin_user_suspension` adds `users.suspended_at`,
  `suspended_by_id` (FK → users, SET NULL), `suspension_reason`, plus an index on `created_at`.
- `AuthModule` now also exports `OtpService`. New global `CommonModule` provides `SessionRevocationService`.

**Frontend**
- `AppShell` is shared by the portal and admin layouts (the Step 3 `PortalLayout` was refactored
  onto it). The admin nav is filtered by role, and the brand shows an "Admin" badge.
- Staff log in to `/admin`. The profile menu switches between "Admin console" and "Candidate portal",
  and the public header shows "Admin console" for staff. `RequireAuth` role failures now redirect to
  the user's own home instead of `/`.
- New shared UI: `components/ui/Dialog` (native `<dialog>` confirm modal) and `Button.module.css`.

**Verified**
- Backend: lint/build pass. 27 unit tests (new: revocation boundary, expiry, fail-open). 23 e2e tests
  against real Postgres, including 9 new admin tests: RBAC per role, dashboard shape, search/filter/
  scope/pagination/validation, detail, suspend → the old token is rejected at once → login blocked →
  reactivate, force-logout of 2 sessions, the self/staff/super-admin protections, role change
  (super-admin only, can't grant super_admin, old token dead, new login has the new role), and staff
  creation → setup OTP → reset → login as editor. Ran twice, stable.
- CLI: promotes an existing account and rejects unknown emails.
- Browser (1024px + 375px): super admin lands on `/admin`, KPIs render, search updates the URL,
  suspend via dialog shows the banner and status, create editor → team list, editor sees only
  Dashboard + Exam Builder and is redirected from `/admin/staff`, user table becomes cards on phones
  with no overflow.
- **Still not verified:** MinIO / `docker compose up` (no Docker on this machine).

**Notes for next steps**
- Step 13 (audit log): hook into `AdminUsersService` (suspend, reactivate, force-logout, changeRole,
  createStaff). The actor and target are already available there, so reuse this service rather than
  building a second mechanism.
- Step 7/11/12: replace the admin placeholders above and add their roles to `ADMIN_NAV`.
- The local Prisma dev Postgres (no Docker) can't run concurrent queries, so there are sporadic 500s
  in the browser. That's documented in the README and isn't an app bug.

---

## 2026-09-27 — Step 5: Mail Module (FRD §4.5) ✅

Branch `step-5-mail-module` (on top of `step-4-admin-portal`). The FRD wasn't attached, so code cites
"FRD §4.5" rather than FR-5.x numbers.

**✅ OTP emails now send for real.** Step 2's `ConsoleOtpSender` stub is gone. `AuthModule` binds `OTP_SENDER` →
`EmailOtpSender` (`backend/src/modules/mail/services/email-otp-sender.ts`), which queues a templated email.
Sign-up verification, resend, forgot password and staff invites all go through it. The auth code needed no
other changes (the Step 2 hook worked as designed).

**Templates** (`backend/src/modules/mail/templates/`, shared `renderLayout()`: table-based, inline styles,
HTML + plain text, every value escaped)
| Template | Status | Triggered by |
|---|---|---|
| `verify_email` | **Live** | sign-up, re-register, "resend code", login while unverified |
| `reset_password` | **Live** | forgot password |
| `staff_invite` | **Live** (bonus) | super admin creates a staff account (Step 4). Uses a reset code, with invitation wording |
| `exam_reminder` | **Placeholder**: template + sample data only, nothing sends it | Step 7 should call `mailService.enqueue({ template: 'exam_reminder', data: { name, examTitle, startsAt, durationMinutes, examPath? } })` |

**Pipeline**
- `MailService.enqueue()` → inserts a `mail_messages` row (`queued`) → BullMQ job on queue `mail`
  (`attempts: 3`, `backoff: exponential 10 s` → retries after 10 s and 20 s, `removeOnComplete`, `jobId` = mail id).
  Request handlers never touch SMTP.
- `MailProcessor` (BullMQ worker, concurrency 5) renders the email → Nodemailer SMTP → row becomes `sent` +
  `providerMessageId`. On error the row becomes `retrying` (or `failed` with `failedAt` on the last attempt),
  storing `lastError` and `attempts`, and the error is rethrown so BullMQ retries. Already-sent rows are skipped (idempotent).
- If Redis/the queue is down, `enqueue` marks the row `failed` ("Could not queue: …") and the request gets
  **503 `MAIL_UNAVAILABLE`**. `OtpService` then lifts the resend cooldown so the user can retry at once.
- **Delivery log:** migration `20260927150000_mail_messages` adds `mail_messages` (to_address, template, subject,
  status `queued|sending|retrying|sent|failed`, attempts/max_attempts, provider_message_id, last_error,
  last_attempt_at, sent_at, failed_at, user_id → users SET NULL + audit columns). **Bodies are never stored, and
  OTP codes are kept out of subjects.** Job data (which contains the code) is removed from Redis on completion.
- Admin API (FRD §4.5 visibility): `GET /api/v1/admin/mail?search&status&template&page` (admin, support);
  `GET /api/v1/admin/mail/templates` and `/templates/:name/preview` (HTML with sample data, strict CSP;
  admin, support, editor). UI: **Admin → Email** (delivery log with status/error/attempts + template previews
  in a sandboxed iframe).

**Env vars I need from you (SendGrid recommended; SES works the same way)**
```
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.sendgrid.net        # SES: email-smtp.<region>.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false                  # true only for port 465
SMTP_USER=apikey                   # SES: SMTP username
SMTP_PASS=<SendGrid API key>       # SES: SMTP password
MAIL_FROM="InterviewPrep <no-reply@your-verified-domain.com>"
MAIL_REPLY_TO=support@your-domain.com   # optional
APP_BASE_URL=https://your-app-url       # used in email links
```
Optional: `MAIL_MAX_ATTEMPTS` (3), `MAIL_RETRY_BASE_DELAY_MS` (10000), `MAIL_WORKER_ENABLED` (true; set false on
API-only instances once workers run separately). In production `MAIL_TRANSPORT` must be `smtp`
(config validation enforces it) and `SMTP_HOST` is required.

**Local dev:** docker-compose gains **Mailpit** (`axllent/mailpit:v1.31`, inbox http://localhost:8025) and the backend
container sends real SMTP to it. Without Docker, `MAIL_TRANSPORT=log` prints each email (`[DEV MAIL] …`).

**Other changes**
- New `QueueModule` (shared BullMQ connection from `REDIS_URL`, `maxRetriesPerRequest: null`). The mail producer
  uses a fail-fast connection, and the worker is loaded via `ConditionalModule` (`MAIL_WORKER_ENABLED`).
- Test infrastructure: `test/utils/test-app.ts` (`createTestApp`) now boots every e2e suite with fakes for Redis,
  S3, the mail queue (`FakeQueue`, which drives the real `MailProcessor` with retries) and SMTP (`CapturingTransport`).
  Auth/admin e2e tests now read OTP codes from the actual rendered emails. Suites also clean up their `mail_messages`.
- **Type hygiene:** `npm run typecheck` (new) covers test files. It surfaced 15 latent type errors in specs from
  Steps 2–4 (mis-typed ConfigService mocks, a nonexistent `supertest/types` import from the Nest scaffold, a user
  fixture missing Step 4 columns), all fixed. `fakeConfig()` helper added.

**Verified**
- Backend: typecheck (0 errors), lint, build. 43 unit tests (templates: code in body but not subject, links,
  HTML escaping; enqueue options; worker send/retry/final-failure/idempotency; queue-down → 503; OTP sender
  template choice; cooldown lifted on send failure). 28 e2e tests against real Postgres, including a new mail suite:
  sign-up queues without sending inline → worker sends → emailed code verifies the account; 2 failures then
  success = `sent`, 3 attempts; 3 failures = `failed`; queue down = 503 + immediate retry allowed; admin log/filter/
  previews/404/401. Stable across repeated runs.
- **Real SMTP**, via a local `smtp-server` sink: the backend authenticated (SendGrid-style `apikey` user) and delivered
  `multipart/alternative` (text + HTML). The rendered email looked right in the browser, and its code verified the account.
  With the sink stopped: attempt 1 and attempt 2 failed (`ECONNREFUSED`, logged as `retrying`, backoff 10 s then
  20 s). With the sink restarted, attempt 3 was `sent`.
- Browser: Admin → Email shows the log (e.g. the reset at 3/3 attempts) and template previews.
- **Not verified:** the real BullMQ worker against a real Redis. This machine has no Redis or Docker, so the
  queue was simulated in-process (same processor code, same backoff formula). Run `docker compose up` and send a
  sign-up; Mailpit should receive it. MinIO is also still unverified.

**Notes for next steps**
- Step 7: wire `exam_reminder` (scheduled BullMQ job, e.g. `delay` until 30 min before start).
- Step 15 (notifications) can reuse the `QueueModule` pattern for its own queue.
- A "resend" action for failed mails in Admin → Email would be easy to add (re-enqueue a new record).
