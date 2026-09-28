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

---

## 2026-09-28 — Step 6: Question Bank & Question Set Upload (FRD §4.11) ✅

Branch `step-6-question-bank` (from `main` @ Step 5). The FRD wasn't attached, so code cites "FRD §4.11"
rather than FR-11.x numbers. **Step 1 is still outstanding**, so this step added the question-bank tables itself
(migration `20260928090000_question_bank`): `topics`, `tags` (kind `skill|company`), `questions`,
`question_versions`, `question_tags`, `question_imports` + enums `question_type`, `question_status`,
`difficulty`, `tag_kind`. Step 1 should reconcile them with the Database Module Design Document.

**Bulk-upload file format (for the Content Acquisition Tool)**. The full spec is in
**[`docs/question-import-format.md`](docs/question-import-format.md)**. Summary:
- `POST /api/v1/admin/question-imports` (multipart `file`, editor/admin token), `.json` or `.csv`, UTF-8,
  ≤ 5 MB, ≤ 1000 questions. Query flags: `dryRun`, `createMissingTaxonomy`, `submitForReview`.
- **JSON:** `{ "questions": [ { externalId?, type: "mcq"|"coding", title, body (Markdown), topic (slug|name),
  difficulty: "easy"|"medium"|"hard", tags?: ["slug", "company:Name"], explanation?, marks?,
  mcq?: { allowMultiple?, options: [{ text, isCorrect }] },
  coding?: { timeLimitMs?, memoryLimitMb?, starterCode?: { python|javascript|java|cpp: "…" },
  testCases: [{ input, expectedOutput, isSample?, weight? }] } } ] }` (a bare array also works).
- **CSV:** header row, columns `external_id,type,title,body,topic,difficulty,tags(pipe-separated),explanation,marks,
  option_1…option_8,correct("2" or "1,3"),allow_multiple,time_limit_ms,memory_limit_mb,starter_code(JSON),test_cases(JSON)`.
- **Semantics:** each row is validated separately (valid rows import, invalid ones are reported with `{ row, field, message }`).
  Re-importing the same `externalId` updates that question in place: unchanged content is a no-op, changed content
  becomes a new version, back to draft/review, and the old version stays live until approved. Imports never publish
  directly. Response: `{ created, updated, unchanged, failed, rows[], newTaxonomy }`.
- Templates: `GET /api/v1/admin/question-imports/template?format=json|csv`. `db/seed/questions.sample.json`
  is itself a valid import file.

**Sample questions in dev data: 12** (8 MCQ + 4 coding, all published, 1 version each) across 10 topics and 16 tags
(10 skill, 6 company), loaded by `npm --prefix backend run seed:dev` (idempotent; re-running reports
"12 unchanged"). My local DB currently has 14, because 2 more were created while testing the UI (a JavaScript MCQ
via the editor and one via CSV import).

**What's built**
| Area | Status |
|---|---|
| Manual editor (`/admin/questions/new?type=mcq|coding`, `/admin/questions/:id`) | **Functional**: title, Markdown body, topic, difficulty, marks, skill/company tags, explanation; MCQ options (2–8, single/multiple correct); coding limits, starter code (Python/JS/Java/C++), test cases (sample/hidden, weights). Server-side validation errors listed per field |
| Versioning | **Functional**: every save adds an immutable `question_versions` row (with change note); no-op saves are skipped; MCQ option ids stay stable across versions. `current_version_id` = latest, `published_version_id` = live. History panel with a read-only version viewer |
| Approval workflow | **Functional**: draft → pending_review → published / rejected (note required) → fix → resubmit; archive/restore. Editors submit/withdraw, admins approve/reject/archive/restore (API `@Roles` + UI). Editing a published question keeps the old version live |
| Bulk upload (`/admin/questions/import`) | **Functional**: CSV/JSON, dry-run validation report, import of valid rows, downloadable error-report CSV, template downloads, import history |
| Taxonomy (`/admin/taxonomy`) | **Functional**: topics (name, slug, description, order, question counts; can't delete while in use) and skill/company tags (deleting detaches them from questions) |
| Question list (`/admin/questions`) | **Functional**: status tabs with counts (incl. review queue), search (title/external id), type/topic/difficulty filters, pagination |

**API** (`/api/v1/admin`, roles in brackets; super_admin passes all)
`GET/POST topics`, `PATCH/DELETE topics/:id`, `GET/POST tags`, `PATCH/DELETE tags/:id` [read: editor, admin, support;
write: editor, admin] · `GET questions`, `GET questions/:id`, `GET questions/:id/versions/:n`, `POST questions`,
`PUT questions/:id`, `POST questions/:id/submit|withdraw` [editor, admin] · `POST questions/:id/approve|reject|archive|restore`
[admin] · `POST/GET question-imports`, `GET question-imports/template` [editor, admin].
Error codes: `INVALID_QUESTION` (+ `errors[]`), `INVALID_TRANSITION`, `QUESTION_ARCHIVED`, `TYPE_IMMUTABLE`,
`QUESTION_NOT_FOUND`, `VERSION_NOT_FOUND`, `SLUG_TAKEN`, `TOPIC_IN_USE`, `INVALID_IMPORT_FILE`.

**Verified**
- Backend: typecheck 0 errors, lint, build. 58 unit tests (new: content rules, option ids, key-order-independent fingerprint,
  CSV/JSON parsing incl. quoting, BOM, JSON cells, limits). 38 e2e tests against real Postgres, including a new question-bank
  suite (10): RBAC, validation, versioning + option-id stability + no-op saves, the full workflow incl. reject → fix → approve,
  live version kept while editing, archive/restore, filters/status counts, taxonomy protections, dry run writes nothing,
  partial import + idempotent re-import + update → v2 + submitForReview, createMissingTaxonomy (company tag), bad files,
  templates. Suites clean up after themselves.
- **Found and fixed while testing:** re-importing identical coding questions created spurious versions, because Postgres
  `jsonb` reorders object keys. The fingerprint now uses a sorted-key stringify, and re-running the seed reports "12 unchanged".
- Browser (1024px): created an MCQ in the editor → saved v2 with a note → submitted → approved via the dialog (history shows
  "v2 · current · live"); CSV import dry run (1 valid, 1 invalid with both errors) → import → history; taxonomy page blocks
  deleting a used topic. Also fixed the editor layout at mid widths (the side panel now stacks under 1200px).

**Notes for next steps**
- Step 7 (exam builder): select questions via `QuestionService`/`GET /admin/questions?status=published`, and snapshot
  **`publishedVersionId`** into exams so later edits don't change a running exam. MCQ answer keys = option `id`s.
- Step 8 (judge): test cases live in `question_versions.content.coding.testCases` (`isSample` = visible). Define the output
  comparison rules there.
- Step 19 (search): `questions` has title/topic/difficulty/type/status indexes; add the `search_vector`/GIN index then.
- Candidate-facing practice (Step 6 placeholder `/practice`) isn't wired yet. It needs a published-only read API.

---

## 2026-09-28 — Session handoff (after Step 6)

**Git:** `main` = Step 5 (`b6816a4`, pushed to GitHub). Step 6 is committed on branch **`step-6-question-bank`**
(`5434366`), **not merged/pushed yet**. To publish it: `git switch main && git merge --ff-only step-6-question-bank && git push`.
Uncommitted: this handoff entry and `tools/local-dev/` (no-Docker dev helpers).

**Done:** Steps 0, 2, 3, 4, 5, 6. **Outstanding:** Step 1 (full schema reconciliation + FR tags; the FRD and DB design doc
were never attached; tables were added per step), then Step 7 (Virtual Interview & Exam Engine) is next in the build order.

**Local environment (this Windows machine has no Docker/Redis):** see `tools/local-dev/README.md`.
- DB: Prisma local Postgres, server name `interview-prep`, `postgres://postgres:postgres@localhost:51214/template1?sslmode=disable`
  (every DB name maps to the same database; migrations: use `migrate diff --from-config-datasource` + `migrate:deploy`, see README).
  All 6 migrations applied; seed loaded (12 sample questions + 2 test ones).
- E2E tests: `E2E_DATABASE_URL=<url above> npm --prefix backend run test:e2e` (38 passing). Unit: 58 passing. `npm run typecheck` = 0 errors.
- Dev accounts in the local DB (passwords are in the owner's hands, not recorded here): super admins `sandysanthosh24997@gmail.com`
  (owner) and `s3check@example.test` (test); editor `divya.editor@example.test`; candidates `nisha.kapoor@example.test` and
  sample `*@example.test` users (Meera Iyer is suspended as sample data).

---

## 2026-09-28 — Step 7: Virtual Interview & Exam Engine (FRD §4.6) ✅

Branch `step-7-exam-engine` (from `step-6-question-bank`). The FRD still wasn't attached, so code cites "FRD §4.6"
rather than individual FR-6.1…FR-6.8 numbers. Tag them once the FRD is available. Step 1 is still outstanding; this
step added its own tables (migration `20260928120000_exam_engine`): `exams`, `exam_sections`, `exam_items`,
`exam_sessions`, `exam_session_items`, `exam_session_events` + enums `exam_kind`, `exam_status`,
`exam_session_status`, `exam_submit_reason`.

**Session-resume mechanism (for Step 14 Proctoring and later modules).** The server owns the clock. Each
`exam_sessions` row stores `time_remaining_ms` (plus `section_remaining_ms`) as of `last_synced_at`, and every client
contact (resume on page load, autosave every `EXAM_AUTOSAVE_INTERVAL_SECONDS`, submit) charges the elapsed time in a
row-locked transaction and saves answers. A reconnecting client calls `POST /exam-sessions/:id/resume` and gets back
the saved answers and remaining time, and on pause-on-disconnect exams any gap beyond `EXAM_OFFLINE_GRACE_SECONDS`
isn't charged. Lifecycle hooks: every transition is written to `exam_session_events` (`started`, `resumed` =
reconnect after a gap, with `gapMs`/`chargedMs`, `section_advanced`, `submitted` + reason) and emitted after commit
via `ExamSessionLifecycle.subscribe()`. **Step 14 should subscribe there and append its own event types; Step 8 should
grade on `submitted`.**

**What's built**
| Area | Status |
|---|---|
| Admin builder `/admin/exams`, `/admin/exams/new`, `/admin/exams/:id` (replaces the Step 4 placeholder) | **Functional**: mock test / virtual interview; instructions (Markdown + preview); total time or per-section timers; pause-on-disconnect toggle; shuffle questions/options; attempts limit; pass mark; sections with marks-per-question override, negative marking %, partial credit; question picker (published questions only, search/type/topic/difficulty); reorder/remove; server problems shown on the section/question they belong to; publish checklist; publish/unpublish/archive/restore (admin), delete untouched drafts |
| Catalog `/tests` (+ public `/exams`, `/interviews` redirect there) | **Functional**: cards with duration/questions/marks, attempts used, Resume / Try again; recent attempts list |
| Pre-test `/tests/:id` | **Functional**: facts, section table (marks, timing, penalties), instructions, "how this test works", consent checkbox required to start |
| Runtime `/exam/:sessionId` (full screen) | **Functional**: MCQ (single/multi) with clear answer; mark for review; palette with states + legend; section + total timers (warning/danger tones); coding: Monaco (bundled, lazy-loaded), language selector with per-language drafts, reset, **Run sample tests**; autosave + offline banner + local backup; submit / finish-section confirmation with counts; auto-submit at zero; submitted summary |
| Code runner | `CODE_RUNNER=disabled` (default): Run explains it's unavailable. `CODE_RUNNER=local` (dev only, refused in production): JavaScript + Python as child processes with a time limit. **Not a sandbox.** Java/C++ → "unsupported". **STEP 8 HOOK:** bind the judge to `CODE_RUNNER` in `exams.module.ts` |

**Rules and design decisions**
- **Versions are pinned.** Exam items pin each question's live version on every save/publish; an attempt copies
  everything it needs (sections, marks, negative %, option order) at start. Editing or unpublishing an exam never
  changes a running attempt. Only admins can change a published exam, and it must stay publishable.
- **One attempt at a time** per candidate per exam (Postgres advisory lock); `maxAttempts` enforced (409 `ATTEMPT_LIMIT_REACHED`).
- **Timed sections** run in order; time spills into the next section; "Finish section" forfeits the remainder; answers
  to other sections are rejected per item (`SECTION_LOCKED`) without failing the rest of the save. Only the current
  section's questions are sent to the client.
- **Answers are validated** against the pinned version (unknown options, multi-pick on single-answer, language, 64 KB
  code). Bad answers come back in `rejected[]`; the rest are saved. Candidates never receive `isCorrect`,
  explanations or hidden tests.
- **Auto-submit**: the client submits at zero with `auto: true`; the server accepts it only if its clock agrees
  (within the grace), so a client that counted down while offline doesn't lose server-side time. The server also
  closes attempts itself: on the next contact, and via `ExamSessionSweeper` (every `EXAM_SWEEP_INTERVAL_SECONDS`)
  for strict-clock attempts that ran out and pause-on-disconnect attempts idle for `EXAM_ABANDON_AFTER_HOURS` (`abandoned`).
- Output comparison for test cases (`outputsMatch`): CRLF→LF, trailing whitespace per line and trailing blank lines
  ignored. Step 8's grader should reuse it.
- `exam_reminder` email stays unwired: Step 7 exams are on-demand (no scheduled start time). Wire it when scheduled
  exams/enrolment exist.

**API** (`/api/v1`)
- Admin [editor, admin; publish/unpublish/archive/restore = admin]: `GET/POST admin/exams`, `GET/PUT/DELETE admin/exams/:id`,
  `POST admin/exams/:id/publish|unpublish|archive|restore`. `GET admin/questions?live=true` added for the picker.
- Candidate [any signed-in user]: `GET exams?kind`, `GET exams/:id`, `POST exams/:id/sessions {consent:true}` (201 new /
  200 existing), `GET exam-sessions`, `GET exam-sessions/:id` (read-only), `POST exam-sessions/:id/resume`,
  `PATCH exam-sessions/:id {answers[]}` (autosave), `POST exam-sessions/:id/next-section`, `POST exam-sessions/:id/submit
  {answers[], auto?}`, `POST exam-sessions/:id/run {itemId, language, code}` (sample tests, cooldown `CODE_RUN_COOLDOWN_SECONDS`).
- Error codes: `EXAM_NOT_FOUND`, `INVALID_EXAM` (+`errors[]`), `INVALID_TRANSITION`, `EXAM_ARCHIVED`, `EXAM_HAS_ATTEMPTS`,
  `PUBLISHED_EXAM_ADMIN_ONLY`, `SESSION_NOT_FOUND`, `SESSION_CLOSED` (+`submitReason`), `ATTEMPT_LIMIT_REACHED`,
  `NOT_SECTION_TIMED`, `ITEM_NOT_FOUND`, `NOT_CODING_QUESTION`, `SECTION_LOCKED`, `RUN_COOLDOWN`.
- New env vars: `EXAM_AUTOSAVE_INTERVAL_SECONDS` (15), `EXAM_OFFLINE_GRACE_SECONDS` (45, ≥ 2× autosave),
  `EXAM_ABANDON_AFTER_HOURS` (24), `EXAM_SWEEPER_ENABLED` (true), `EXAM_SWEEP_INTERVAL_SECONDS` (60), `CODE_RUNNER`
  (`disabled`), `CODE_RUN_COOLDOWN_SECONDS` (3).
- Dev seed now also creates 2 published exams: "Software Engineering Fundamentals — Mock Test" (45 min, 8 MCQ with 25%
  negative marking + 2 coding) and "Backend Engineer — Virtual Interview" (timed sections 5 + 30 min, strict clock, 3 attempts).
- Frontend deps added: `@monaco-editor/react`, `monaco-editor` (bundled, lazy chunk), `react-markdown` (safe Markdown
  for question bodies/instructions). `Dialog` gained `size="wide"`.

**Verified**
- Backend: typecheck 0 errors, lint, prettier. **81 unit tests** (new: clock charging/pause/strict/spill-over/forfeit,
  answer validation, no answer-key leakage, output comparison, builder rules, real-process runner: verdicts, time
  limit, no env leakage). **47 e2e tests** against real Postgres (new exam suite, 9): builder RBAC + publish rules,
  catalog/consent/one-attempt/no answer keys, autosave + resume, pause-on-disconnect charges only the grace + `resumed`
  event, strict clock auto-submits, sweep (expired / abandoned / untouched), timed sections lock + forfeit, submit +
  attempt limit + live-exam edits don't touch running attempts + early `auto` submit refused, run endpoint.
- Frontend: lint, prettier, `tsc -b`, production build.
- Browser (1280px + 375px) with the local stack: built and published an exam (validation errors placed on the section),
  took the mock test (answer, mark for review, autosave), reloaded → answers/flags/position/timer restored; **stopped the
  API mid-test** → offline banner, answered offline (kept in localStorage), reloaded, restarted the API → the offline
  answer synced and the server charged 45 s for a 98 s outage; Monaco + Run (2/2 samples passed via the local runner);
  submit dialog + summary; timer run-out → auto-submitted as `time_expired`; timed-section interview on a phone:
  palette drawer, finish section → next round with its own clock. No horizontal overflow.
- **Found and fixed while testing:** (1) a single failed request on load stranded the runtime on an error page →
  load now retries with backoff + "Try again"; (2) **`CODE_RUNNER=local` on Windows** called `python3` (the Python
  install-manager shim), which with the stripped run environment began downloading Python into the temp run dir (killed
  by the time limit; nothing installed; leftover dir removed) → the runner now resolves the real interpreter path once
  and runs it with `-I`; (3) phone layout tweaks (compact top bar, palette above the two-row bottom bar).
- **Not verified:** real Redis/BullMQ and Docker (still none on this machine); Java/C++ execution (Step 8).

**Notes for next steps**
- Step 8: bind the judge to `CODE_RUNNER`; grade `exam_session_items` (use `marks`, `negative_mark_percent`,
  `partial_scoring` on the item, `outputsMatch`); subscribe to `submitted`. Add grading columns/status then.
- Step 9: scorecards read `exam_sessions.snapshot` + items; `/history` placeholder and the dashboard "Recent activity"
  widget can list `GET /exam-sessions`.
- Step 14: subscribe to `ExamSessionLifecycle`; `exam_session_events` is the place for tab-switch/fullscreen events.
- Known local-dev caveat: if the page is **reloaded while the API is down**, session restore fails and the user lands on
  `/login` (they return to the exam after signing in, answers intact). Treating "server unreachable" as "still signed in"
  in `AuthProvider` would remove that step. It's a Step 2 change, left for review.
- Local dev: the Prisma dev Postgres degraded after heavy concurrent use in the browser session ("Server has closed the
  connection" in e2e); `npx prisma dev stop interview-prep` + `start` fixed it. Browser tests used separate
  `@example.test` accounts (credentials in the gitignored `tools/local-dev/.env.test-accounts`) on
  `http://exam.localhost:5173` so the owner's signed-in session on `localhost` wasn't touched.

---

## 2026-09-28 — Step 8: Evaluation & Code Judge (FRD §4.7) ✅

Branch `step-8-code-judge` (from `main` @ Step 7). The FRD still wasn't attached, so code cites "FRD §4.7" rather than
FR-7.1…FR-7.8. Step 1 is still outstanding; this step added migration `20260928150000_code_judge`: grading columns on
`exam_sessions` (`grading_status`, `score_centi`, `graded_at`, `grading_error`) and `exam_session_items` (`score_centi`,
`outcome`, `graded_at`), plus `code_submissions` and enums `grading_status`, `item_outcome`, `test_verdict`,
`code_submission_kind`, `code_submission_status`.

**Languages supported end-to-end and the sandbox approach**
- **Sandbox: Judge0 CE 1.13** (`CODE_RUNNER=judge0`). Each test case is one Judge0 submission (batched ≤ 20, base64,
  polled). Judge0 runs code in `isolate` sandboxes with per-run CPU time, wall time, memory and stack limits and **no
  network** (`enable_network: false`, `ALLOW_ENABLE_NETWORK=false`). It runs as separate services
  (`docker compose --profile judge up`, config `tools/judge0/judge0.conf`, auth via `X-Auth-Token`). Output comparison
  is ours, not Judge0's.
- **With Judge0: Python 3, JavaScript (Node), Java and C++**, all four editor languages (Judge0 ids 71 / 63 / 62 / 54).
  Java must declare `public class Main`. Per-language limits on top of each question's: Python ×3 time, JavaScript ×2
  time + 64 MB, Java ×2 time + 128 MB, C++ as given; capped at 15 s / 512 MB.
- **Without Docker (this machine):** `CODE_RUNNER=local` runs **JavaScript and Python** end to end (dev only, *not* a
  sandbox, refused in production); Java/C++ report that they need the code judge. `CODE_RUNNER=disabled` (default) runs
  nothing: MCQs are still graded, coding answers are reported as not gradable, and admins can regrade later.
- **Honest status:** Judge0 itself has **not been run on this machine** (no Docker). The Judge0 client is unit-tested
  against an in-memory fake that speaks Judge0's HTTP API (batching, polling, status mapping, auth header, limits,
  errors/timeouts). Runs and grading were verified end to end in the browser with the local runner (Python). Judge0 1.13
  needs privileged containers + **cgroup v1** (see README "Code judge").

**How it works**
- **Queue:** all execution runs on the BullMQ `judge` queue (worker `JudgeProcessor`, `JUDGE_WORKER_CONCURRENCY`, loaded
  when `JUDGE_WORKER_ENABLED`). Requests never run code. "Run" returns **202** and the client **polls**
  `GET /exam-sessions/:id/runs/:runId` every second; the submitted screen polls the attempt every 3 s until
  `grading.status` is `graded`/`failed`. Jobs retry `JUDGE_MAX_ATTEMPTS` times with exponential backoff.
- **Grading** is triggered by the Step 7 lifecycle hook (`submitted`: manual, timed out or abandoned) and deduplicated per
  attempt (job id `grade-<session>` + a status claim). MCQs are graded against the pinned version's answer key with the
  section's marking scheme; coding answers run against **sample + hidden** tests with per-test verdicts
  **AC / WA / TLE / MLE / RE / CE / IE**. Scores are integers in hundredths of a mark.
  - MCQ: exact = full marks; any wrong option = −negative % of the marks; a clean subset of a multi-answer question =
    proportional credit if the section allows partial scoring (else wrong); unanswered = 0.
  - Coding: marks × passed test **weight** / total weight with partial scoring, else all tests must pass; CE = 0; never
    negative.
  - MLE: Judge0 has no MLE status, so a crash with memory ≥ 95% of the limit (or an out-of-memory message) → MLE.
- **Outages:** judge errors retry; after the last attempt the attempt is `failed` with the reason and MCQ scores kept.
  "Judge unavailable" (disabled, unsupported language) fails at once without retrying. `recover()` re-queues attempts
  left `pending` (queue down at submit) or stuck in `grading` (worker died). Admins: `POST /admin/exam-sessions/:id/regrade`.
- **Privacy:** candidates only see sample tests' inputs/outputs. Hidden-test verdicts and truncated outputs are kept in
  `code_submissions.results` for staff: `GET /admin/exam-sessions/:id/grading` (admin, support).

**API** (`/api/v1`): `POST exam-sessions/:id/runs {itemId, language, code}` → 202 (replaces Step 7's synchronous `/run`) ·
`GET exam-sessions/:id/runs/:runId` · `GET admin/exam-sessions/:id/grading` [admin, support] ·
`POST admin/exam-sessions/:id/regrade` [admin] → 202. Session views gain `grading { status, score, maxScore, gradedAt }`
and, once graded, per-item `result { outcome, score }`. New error codes: `JUDGE_UNAVAILABLE` (503, queue down),
`RUN_NOT_FOUND`, `SESSION_NOT_SUBMITTED`; `RUN_COOLDOWN` moved here. New env: `CODE_RUNNER` gains `judge0` (production
allows `disabled|judge0`), `JUDGE0_URL` (required for judge0), `JUDGE0_AUTH_HEADER` (X-Auth-Token), `JUDGE0_AUTH_TOKEN`,
`JUDGE0_TIMEOUT_SECONDS` (60), `JUDGE_WORKER_ENABLED` (true), `JUDGE_WORKER_CONCURRENCY` (4), `JUDGE_MAX_ATTEMPTS` (3),
`JUDGE_RETRY_BASE_DELAY_MS` (5000).

**Frontend:** Run shows "Running…" while polling, then per-example verdicts with time/memory, or the compiler output for
CE. The submitted screen shows "Grading your answers…", then **score / max** and how many questions were fully correct
(the full scorecard is Step 9).

**Verified**
- Backend: typecheck 0, lint, prettier. **93 unit tests** (new: verdict mapping, overall verdict, per-language limits,
  MCQ/coding scoring incl. negative/partial/rounding, Judge0 client vs a fake Judge0, local runner). **53 e2e tests** (new
  judge suite, 7): queued run → poll → sample-only results + language limits, CE output, cooldown/ownership/MCQ guard;
  judge down → 3 attempts → failed; queue down → 503; grading math end to end (+2 −0.5 + 10×¾ = 9) with hidden verdicts
  for staff only; no partial credit / unanswered / CE; outage → failed with MCQs kept → admin regrade; judge disabled +
  timed-out attempt graded via the sweep; retry takeover of a stuck `grading`. Frontend: lint, prettier, build.
- Browser (local runner, Python): Run → 202 → one poll → 2/2 samples passed; submit → "Grading…" → **6.75 / 29**; after
  the seed fix below and an admin regrade → **10 / 29**, all 4 tests (2 hidden) AC in the staff report.
- **Found while testing:**
  1. **Seed data bug:** "Pair with target sum" hidden test `5 -8 / -1 -3 -5 4 -3` had two valid answers ((1,2) and
     (2,4)) but only accepted `2 4`, so correct solutions lost marks. Fixed to `-1 -3 -6 4 -2` (unique answer). The seed
     re-publishes it as v2, and the seeded mock test was re-saved to pin v2. Earlier attempts keep v1 by design.
  2. A grading job whose status reset failed (local DB hiccup) left the attempt stuck in `grading` until recovery.
     Retries of the same job may now re-claim it (e2e covered).
- **Not verified:** a real Judge0 instance, real Redis/BullMQ (still no Docker/Redis here).

**Notes for next steps**
- Step 9 (scorecards): read `exam_sessions.score_centi` / `grading_status` and per-item `outcome` / `score_centi`; coding
  details from the latest `code_submissions` row with `kind = 'grade'` (show candidates **sample** results only). Totals
  can be negative with negative marking; decide whether scorecards floor them at 0.
- Step 10 (analytics): `code_submissions` has per-test time/memory for performance stats.
- Step 13 (audit log): hook `JudgeService.regrade` (the actor is an admin).
- Production: run Judge0 on dedicated hosts (privileged containers) and set `JUDGE_WORKER_ENABLED=false` on API-only
  instances once separate workers exist. WebSockets could replace polling later without changing the endpoints.
