# Project Context — Interview Prep Portal

## What this is
An online interview-preparation & examination platform (LeetCode/GeeksforGeeks/
HackerRank-style): candidates practice MCQ + coding questions, take timed mock
exams and virtual interviews, get auto-scored, and view analytics. Admins manage
users, the question bank, exams, payments, and ads.

## Reference documents (attach when starting a NEW module for the first time)
- Functional Requirements Document (FRD) — full module list & requirements
- Database Module Design Document — full schema (tables, columns, indexes)
- Content Acquisition Tool FRD — separate tool, not part of the core app build

## Tech stack (do not deviate without discussion)
- Frontend: React 19 + TypeScript, Vite, React Router (data router, `react-router` package)
- Backend: Node.js 24 + TypeScript on **NestJS** (chosen in Step 0), ESM (`"type": "module"`)
- ORM / migrations: **Prisma 7** (`prisma-client` generator + `@prisma/adapter-pg` driver adapter)
- Database: PostgreSQL 17
- Cache/Queue: Redis + BullMQ
- Code execution: Judge0 or Dockerized sandbox workers
- Object storage: S3-compatible
- Auth: JWT (access + refresh token), OTP via Redis-backed short-lived codes

## Conventions
- All DB tables use UUID primary keys, `created_at`/`updated_at`/`deleted_at` audit columns
- All API routes are versioned under `/api/v1/`
- All monetary values stored as integer minor units (cents), never floats
- Every module's requirements are tagged FR-X.X — reference these in code comments
  where a requirement is non-obvious, so the FRD and code stay traceable to each other

### Database (Prisma)
- Schema lives in `db/schema.prisma`; migrations in `db/migrations/` (Prisma migrate).
  Never edit an applied migration — add a new one (`npm --prefix db run migrate:dev -- --name <name>`)
- Tables/columns are snake_case in Postgres (`@@map`/`@map`), camelCase in TypeScript
- PK: `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`
- Audit columns: `createdAt` (`created_at`, default now), `updatedAt` (`updated_at`, `@updatedAt`),
  `deletedAt` (`deleted_at`, nullable) — all `@db.Timestamptz(6)`. Soft delete = set `deleted_at`;
  queries must filter `deletedAt: null` unless explicitly including deleted rows
- Money: `Int`/`BigInt` minor units, column names end in `_cents` (or `_minor` for multi-currency)
- The Prisma client is generated into `backend/src/generated/prisma/` (gitignored) — import
  from `../generated/prisma/client.js`; access the DB only through the injected `PrismaService`

### Backend (NestJS)
- One Nest module per FRD module under `backend/src/modules/<feature>/`, split into
  `controllers/`, `services/`, `models/` (DTOs, request/response types), plus `<feature>.module.ts`
- Controllers are thin (HTTP only); business logic goes in services
- Global prefix `api` + URI versioning with default version `1` → every route is `/api/v1/...`
  automatically; use `@Version('2')` only for a breaking change
- Config: `@nestjs/config`, validated with Joi in `src/config/env.validation.ts`. Every new env var
  must be added to that schema, the `EnvVars` interface, and `backend/.env.example`.
  Read it via `ConfigService<EnvVars, true>` with `{ infer: true }`
- ESM: relative imports use the `.js` extension (e.g. `./app.module.js`)
- Shared cross-cutting code goes in `src/common/` (guards, filters, interceptors, decorators)
- Errors the frontend branches on: throw `AppError(status, 'SOME_CODE', message, details?)`
  (`src/common/errors/app-error.ts`) → body `{ statusCode, code, message, ...details }`
- Tests: Vitest — unit specs next to the code (`*.spec.ts`), e2e specs in `backend/test/` (`*.e2e-spec.ts`).
  DB-backed e2e suites run only when `E2E_DATABASE_URL` is set; Redis is faked with `test/utils/fake-redis.ts`

### Auth & RBAC (Step 2)
- **Every route requires a valid access token by default** (global `JwtAuthGuard`). Mark open
  routes with `@Public()` (`src/common/decorators/public.decorator.ts`)
- Restrict by role with `@Roles('admin', 'editor')` (global `RolesGuard`); `super_admin` always passes.
  Roles: `candidate | editor | support | admin | super_admin`
- Get the caller with `@CurrentUser() user: AuthUser` (`{ id, role }` from the JWT, no DB hit)
- Access token: HS256 JWT, 15 min, sent as `Authorization: Bearer`. Refresh token: opaque, stored
  as SHA-256 in `refresh_tokens`, delivered only as the HttpOnly `refresh_token` cookie
  (Path `/api/v1/auth`, SameSite=Strict), rotated on every refresh with family-reuse detection
- To log a user out everywhere (suspension, role change, password reset), call
  `TokenService.revokeAllForUser`. It revokes refresh tokens **and** kills existing access tokens
  immediately: `SessionRevocationService` (`src/common/auth/`) stores a per-user "revoked at" (ms)
  in Redis and `JwtAuthGuard` rejects tokens whose `iatMs` claim is earlier. It fails open if Redis is down
- Staff roles: `editor | support | admin` (+ `super_admin`). API access by role (FRD §4.3):
  admin dashboard = any staff · user list/detail = admin, support · suspend/reactivate/force-logout =
  admin · role changes + creating staff = super_admin only. Only super_admin can act on staff
  accounts; nobody can act on themselves or on a super_admin. `super_admin` is never granted through
  the API. Bootstrap it with `npm --prefix backend run admin:promote -- <email>` (after `build`)
- Error bodies from auth carry a machine-readable `code` (see `modules/auth/models/auth-error.ts`)
- Frontend: access token lives in memory only (`src/lib/api.ts`); `apiFetch` refreshes once on 401.
  Use `useAuth()` for the user; wrap protected routes in `<RequireAuth roles={[...]}>`

### Object storage (Step 3)
- `StorageService` (`src/storage/`, global): `putObject`, `deleteObject`, `getSignedUrl`. The bucket
  is private. Store only object **keys** in the DB, and return short-lived presigned GET URLs
  (`S3_PRESIGNED_URL_TTL_SECONDS`, default 1 h). Never return raw bucket URLs.
- Key layout: `users/<userId>/<kind>/<uuid>.<ext>` (e.g. `avatar`, `resume`)
- Uploads go through the API as multipart (`FileUploadInterceptor(rules)`, field `file`). Validate
  type by **magic bytes** (`upload-rules.ts`), never trust the client MIME type, and cap size in
  the interceptor. When replacing a file, delete the old object (best effort).
- Local: MinIO in docker-compose (`S3_ENDPOINT=http://minio:9000`, browser URLs signed for
  `S3_PUBLIC_ENDPOINT=http://localhost:9000`). Prod: AWS S3/R2; omit the endpoint and use an IAM role.

### Mail & queues (Step 5)
- **Never send email from a request handler.** Call `MailService.enqueue({ to, template, data, userId? })`
  (`src/modules/mail/services/mail.service.ts`). It writes a `mail_messages` row and adds a BullMQ job;
  `MailProcessor` renders and sends it via Nodemailer, retrying with exponential backoff
  (`MAIL_MAX_ATTEMPTS`=3, `MAIL_RETRY_BASE_DELAY_MS`=10 s → 10 s, 20 s). If the queue is unreachable,
  `enqueue` throws `503 MAIL_UNAVAILABLE`
- New email = add a typed entry to `MailTemplates` + a renderer + `SAMPLE_DATA` in
  `src/modules/mail/templates/index.ts`, using `renderLayout()` and escaping every value with `escapeHtml`.
  Every template must produce subject, HTML and plain text. **Never put secrets (OTP codes, tokens) in the
  subject**, because subjects are stored in `mail_messages`. Bodies are never stored
- BullMQ: `QueueModule` (`src/queue/`) holds the shared connection (`maxRetriesPerRequest: null` for workers).
  Producers register their queue with a fail-fast connection (`enableOfflineQueue: false`, as `MailModule` does).
  Workers live in their own module loaded with `ConditionalModule.registerWhen(…, MAIL_WORKER_ENABLED)`
- Transport: `MAIL_TRANSPORT=smtp` (any SMTP relay: SendGrid, SES, Mailpit) or `log` (dev/test only;
  production refuses it)
- Tests: `test/utils/test-app.ts` `createTestApp()` boots AppModule with Redis, S3, the mail queue and SMTP
  faked; `t.lastCode(email)` runs the real MailProcessor and returns the code from the rendered email

### Question bank (Step 6)
- `questions` is the stable identity; content lives in **immutable** `question_versions` rows. Every
  edit (UI or re-import) adds a version via `QuestionService.update()`, and identical content adds none
  (compared with `contentFingerprint`, key-order independent). `current_version_id` = latest,
  `published_version_id` = what candidates see. **Serve candidates from `publishedVersion`, never
  `currentVersion`.** Title/topic/difficulty on `questions` mirror the current version for listing
- Workflow: `draft → pending_review → published | rejected`, `archived ↔ draft`. Editors submit/withdraw;
  admins approve/reject/archive/restore. Editing a published question makes it `draft` again while the
  old version stays live
- Version `content` JSON: `{ mcq: { options: [{ id, text, isCorrect }], allowMultiple } }` or
  `{ coding: { timeLimitMs, memoryLimitMb, starterCode: { python|javascript|java|cpp }, testCases: [{ input, expectedOutput, isSample, weight }] } }`.
  MCQ option `id`s are stable across versions: reference them in answer keys (Step 7/8)
- Validation lives in one place for both UI and import: DTOs in `question-input.dto.ts` + cross-field
  `contentProblems()` in `question-content.ts`
- Bulk import format is a public contract: **`docs/question-import-format.md`**. Change it only compatibly
- Dev data: `npm --prefix backend run build && npm --prefix backend run seed:dev` (idempotent; loads
  `db/seed/questions.sample.json`: 10 topics, 16 tags, 12 published questions)

### Frontend (React)
- Routes are declared in `src/app/router.tsx`; unbuilt routes use `<ComingSoonPage title description>`
- Three layouts: `AppLayout` (public site + auth screens), `PortalLayout` (candidate portal) and
  `AdminLayout` (`/admin/*`, staff only). The last two share `AppShell` (sidebar/drawer + top bar with
  `ProfileMenu`). Nav lists live in `components/layout/portalNav.ts` (`PORTAL_NAV`, `ADMIN_NAV`).
  Admin items carry `roles`, which must match the API's `@Roles()`. Per-route role gates use
  `<RequireAuth roles>`, which redirects to the user's own home (`homePathFor(role)`). Staff log in
  to `/admin`, candidates to `/dashboard`
- Destructive actions use the `<Dialog>` confirm modal (`components/ui/Dialog.tsx`, native `<dialog>`);
  shared button styles are in `components/ui/Button.module.css`
- Portal pages read the current user's profile via `useProfile()` (loaded once by `ProfileProvider`);
  after any `/me/*` call, pass the returned profile to `setProfile()` so the header stays in sync
- Shared form controls: `components/form/FormField.tsx` (`FormField`, `TextAreaField`, `FormAlert`);
  icons: `components/icons/Icon.tsx` (inline SVG, no icon library)
- Feature code goes in `src/features/<feature>/`; route-level pages in `src/pages/`;
  shared UI in `src/components/`
- All API calls go through `apiFetch` in `src/lib/api.ts` (base `/api/v1`, cookies included)
- Styling: CSS Modules per component + design tokens (CSS variables) in `src/styles/global.css`

### Tooling
- ESLint (flat config) + Prettier (single quotes, trailing commas) in both apps; 2-space indent, LF
- Local dev via `docker compose up --build` (see README)

## Repo structure
```
/frontend                      React + Vite app
  src/app/router.tsx           route table
  src/components/layout/       AppLayout (public), AppShell, PortalLayout, AdminLayout, portalNav
  src/components/ui/           Dialog, Button styles
  src/components/form/         FormField, TextAreaField, FormAlert
  src/components/icons/        Icon (inline SVG set)
  src/pages/                   route-level pages (Home, ComingSoon, NotFound, Error)
  src/pages/auth/              Signup, VerifyEmail, Login, ForgotPassword
  src/pages/portal/            Dashboard, Profile
  src/pages/admin/             AdminDashboard, AdminUsers, AdminUserDetail, AdminStaff, AdminEmail, Taxonomy
  src/pages/admin/questions/   QuestionsList, QuestionEditor (MCQ + coding, workflow, history), QuestionImport
  src/features/questions/      question-bank API client/types, editor form model, badges
  src/features/admin/          admin API client + types, role/status badges
  src/features/auth/           AuthProvider/useAuth, RequireAuth, auth API client, AuthCard
  src/features/profile/        ProfileProvider/useProfile, profile API, Avatar, ProfileMenu
  src/features/dashboard/      dashboard API types
  src/lib/api.ts               fetch wrapper + in-memory access token + single-flight refresh
  src/styles/global.css        design tokens + base styles
/backend                       NestJS API
  src/main.ts                  bootstrap: /api prefix, v1 versioning, CORS
  src/app.module.ts            root module (ConfigModule, DatabaseModule, feature modules)
  src/config/                  env validation schema + EnvVars type
  src/database/                PrismaService, RedisService (global DatabaseModule)
  src/app.setup.ts             shared HTTP pipeline (prefix, versioning, cookies, validation)
  src/common/                  guards (JwtAuth, Roles), decorators (Public, Roles, CurrentUser), types
  src/modules/<feature>/       controllers/ services/ models/ + <feature>.module.ts
  src/common/errors/           AppError (coded HTTP errors)
  src/common/auth/             SessionRevocationService (immediate access-token revocation)
  src/storage/                 StorageService (S3-compatible, presigned URLs)
  src/modules/auth/            registration, OTP, login, tokens, password reset
  src/modules/profile/         /me/profile, /me/avatar, /me/resume (+ upload rules)
  src/modules/dashboard/       /dashboard (widget contract)
  src/modules/admin/           /admin/dashboard, /admin/users/*, /admin/staff
  src/modules/mail/            MailService (enqueue), MailProcessor (worker), templates/, transport,
                               EmailOtpSender, /admin/mail (delivery log + previews)
  src/queue/                   QueueModule (shared BullMQ connection)
  src/modules/question-bank/   questions/versions/workflow, taxonomy (topics, tags), bulk import
  src/cli/                     promote-super-admin, seed-dev
  src/generated/prisma/        generated Prisma client (gitignored)
  test/                        e2e tests + test/utils (createTestApp, FakeRedis, FakeStorage, FakeQueue, CapturingTransport, fakeConfig)
/db                            Prisma package (CLI + config)
  schema.prisma                data model
  prisma.config.ts             reads DATABASE_URL (env or ../backend/.env)
  migrations/                  SQL migrations
  seed/questions.sample.json   dev seed (also a valid bulk-import file)
/docs
  question-import-format.md    bulk-upload contract (Content Acquisition Tool)
docker-compose.yml             postgres, redis, minio, mailpit, backend, frontend
README.md                      setup instructions
PROJECT_CONTEXT.md             ← this file
PROGRESS_LOG.md                ← running build log, read this every session
```
