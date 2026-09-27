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
- To log a user out everywhere (suspension, password change), call `TokenService.revokeAllForUser`
- Error bodies from auth carry a machine-readable `code` (see `modules/auth/models/auth-error.ts`)
- Frontend: access token lives in memory only (`src/lib/api.ts`); `apiFetch` refreshes once on 401.
  Use `useAuth()` for the user; wrap protected routes in `<RequireAuth roles={[...]}>`

### Frontend (React)
- Routes are declared in `src/app/router.tsx`; unbuilt routes use `<ComingSoonPage>`
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
  src/components/layout/       AppLayout shell (header/nav/footer)
  src/pages/                   route-level pages (Home, Account, ComingSoon, NotFound, Error)
  src/pages/auth/              Signup, VerifyEmail, Login, ForgotPassword
  src/features/auth/           AuthProvider/useAuth, RequireAuth, auth API client, form components
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
  src/modules/auth/            registration, OTP, login, tokens, password reset
  src/generated/prisma/        generated Prisma client (gitignored)
  test/                        e2e tests + test/utils (FakeRedis)
/db                            Prisma package (CLI + config)
  schema.prisma                data model
  prisma.config.ts             reads DATABASE_URL (env or ../backend/.env)
  migrations/                  SQL migrations
docker-compose.yml             postgres, redis, backend, frontend
README.md                      setup instructions
PROJECT_CONTEXT.md             ← this file
PROGRESS_LOG.md                ← running build log, read this every session
```
