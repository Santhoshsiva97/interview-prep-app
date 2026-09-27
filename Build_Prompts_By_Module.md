# Build Prompts — Interview Prep Portal (Module-by-Module)

This is a ready-to-use set of prompts for building the platform incrementally with Claude Code (or any Claude session), designed so each module can be built in its **own session** without re-explaining the whole FRD every time.

---

## Why This Works: The Context-Anchor Technique

Context windows can't hold three FRDs plus a growing codebase forever. The fix isn't to paste more — it's to paste *less*, but make it durable:

1. Two small files live in your repo root: **`PROJECT_CONTEXT.md`** (static — tech stack, conventions, schema reference) and **`PROGRESS_LOG.md`** (growing — a running, dated log of what's been built).
2. Claude Code reads project files directly from disk, so every new session automatically has access to both — you never re-paste them.
3. Every module prompt below starts by pointing Claude at those two files instead of restating history. Each prompt ends by having Claude *append* to `PROGRESS_LOG.md`, so the next module's session inherits full continuity in a few hundred words instead of the full build history.
4. This keeps each session's actual context budget spent on **that module's code**, not on re-reading everything that came before.

Set this up once, then work through the modules in order below.

---

## One-Time Setup

### 1. Create `PROJECT_CONTEXT.md` in your repo root

```markdown
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
- Frontend: React + TypeScript
- Backend: Node.js + TypeScript (Express or NestJS — pick one in Step 0 and stay consistent)
- Database: PostgreSQL
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

## Repo structure (fill in once Step 0 is done)
- /frontend
- /backend
- /db/migrations
- PROJECT_CONTEXT.md  ← this file
- PROGRESS_LOG.md     ← running build log, read this every session
```

### 2. Create an empty `PROGRESS_LOG.md`

```markdown
# Progress Log

(Each completed module appends a dated entry below. Newest entries at the bottom.)
```

### 3. First message in any new Claude Code session on this repo

```
Before doing anything, read PROJECT_CONTEXT.md and PROGRESS_LOG.md in full.
Then confirm back to me in 2-3 sentences what's already built and what tech
stack/conventions you'll follow, before I give you the next module's task.
```

This single check-in prevents drift and costs almost nothing in context.

---

## Build Order

Modules are sequenced by dependency, not by FRD numbering — the database has to exist before auth, auth before portals, question bank before the exam engine, etc.

| Step | Module | FRD Ref |
|---|---|---|
| 0 | Project Scaffolding | — |
| 1 | Database Schema & Migrations | §4.4 |
| 2 | Registration & Login (incl. OTP) | §4.1 |
| 3 | Client Portal Shell | §4.2 |
| 4 | Admin Portal Shell | §4.3 |
| 5 | Mail/Notification Module | §4.5 |
| 6 | Question Bank & Question Set Upload | §4.11 |
| 7 | Virtual Interview & Exam Engine | §4.6 |
| 8 | Evaluation & Code Judge | §4.7 |
| 9 | Scorecard Module | §4.8 |
| 10 | Insights & Analytics | §4.9 |
| 11 | Payment & Subscription | §4.10 |
| 12 | AdSense/Advertising | §4.12 |
| 13 | Audit Log & Security | §5.8 |
| 14 | Proctoring & Anti-Cheating | §5.1 |
| 15 | Notification Center (in-app/push) | §5.2 |
| 16 | Discussion Forum | §5.3 |
| 17 | Gamification & Leaderboard | §5.4 |
| 18 | CMS/Blog | §5.5 |
| 19 | Search & Filter | §5.6 |
| 20 | Support/Helpdesk | §5.7 |
| 21 | B2B/Institute Reporting | §5.9 |

---

## Step 0 — Project Scaffolding

**Prompt:**
```
Set up the initial repository for the Interview Prep Portal described in
PROJECT_CONTEXT.md. Create:
- /frontend: React + TypeScript app (Vite), routing, a basic layout shell,
  ESLint/Prettier config
- /backend: Node.js + TypeScript API (choose Express or NestJS — tell me which
  and why in one sentence), folder structure for controllers/services/models,
  environment config loading (.env), ESLint/Prettier config
- /db: migration tool setup (Prisma, TypeORM, or Knex — pick one), empty
  initial migration
- Docker Compose for local dev: postgres, redis, backend, frontend
- A root README with setup instructions

After finishing, update the "Repo structure" and "Conventions" sections of
PROJECT_CONTEXT.md with your actual choices (framework, migration tool, folder
layout), and create PROGRESS_LOG.md with the first entry describing what's set up.
```

---

## Step 1 — Database Schema & Migrations

**Depends on:** Step 0
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement the full database schema from the Database Module Design Document
(attach it now) as migrations in /db/migrations. Cover all domains: Identity &
Access, Question Bank, Exam/Attempt, Scoring & Analytics, Payments, Platform
Operations, and Engagement — every table, column, constraint, and index listed
in that document.

Set up the ORM/query layer models to match. Seed a minimal dev dataset (a
handful of topics, one sample MCQ question, one sample coding question with
test cases) so later modules have something to work against.

When done, append an entry to PROGRESS_LOG.md listing every table created and
the ORM/migration tool used, and note any schema deviations from the design
document with a one-line reason for each.
```

---

## Step 2 — Registration & Login (incl. OTP)

**Depends on:** Step 1
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.1 (Registration & Login Module), FR-1.1 through FR-1.9:
- Sign-up (name, email, phone, password) with bcrypt/argon2 hashing
- Email OTP verification (6-digit, Redis-backed, 5-10 min TTL, max 5 attempts,
  resend cooldown) — for now, log the OTP to console instead of sending real
  email (Mail Module comes in Step 5)
- Login with JWT access token + HTTP-only refresh token cookie, refresh-token
  rotation
- Forgot/reset password via OTP
- Account lockout after 5 failed logins
- Role-based access control middleware (candidate/admin/editor/support/super_admin)
- Social login (Google OAuth2) as a stretch item if time allows — otherwise
  stub the route and note it as deferred

Build both backend endpoints and minimal frontend screens (signup, OTP verify,
login, forgot password).

When done, append an entry to PROGRESS_LOG.md: endpoints created, auth
middleware location, and confirm the OTP-email stub point so Step 5 knows
where to wire in real sending.
```

---

## Step 3 — Client Portal Shell

**Depends on:** Step 2
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.2 (Client Portal), FR-2.1 through FR-2.8, as the frontend
shell + supporting backend endpoints:
- Authenticated dashboard layout (nav, profile menu)
- Dashboard page (placeholder widgets for streak/recent activity/recommended
  tests — real data wired in once Steps 6-10 exist)
- Profile management (edit fields, avatar/resume upload to S3-compatible storage)
- Placeholder routes for: Practice Library, History/Scorecards, Bookmarks,
  Subscription page (each can show "coming soon" until their backing modules
  are built)
- Responsive layout (mobile through desktop)

When done, append an entry to PROGRESS_LOG.md noting which pages are fully
functional vs. placeholder, so later steps know exactly what to wire up.
```

---

## Step 4 — Admin Portal Shell

**Depends on:** Step 2
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.3 (Admin Portal), FR-3.1 through FR-3.8, as a separate
authenticated admin frontend area + backend endpoints:
- Admin dashboard shell (placeholder KPI widgets — real metrics wired in
  Step 10)
- User management: search/list users, view profile, suspend/reactivate,
  force-logout
- Admin role management: Super Admin can create Admin/Editor/Support accounts
  with role assignment
- Placeholder routes for: Exam/Template Builder, Plan Configuration,
  Transaction Oversight, Ad Slot Configuration, Audit Log Viewer (built out
  in later steps)

When done, append an entry to PROGRESS_LOG.md noting which admin pages are
functional vs. placeholder.
```

---

## Step 5 — Mail/Notification Module

**Depends on:** Step 2
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.5 (Mail Module), FR-5.1 through FR-5.6:
- Nodemailer integration with an SMTP provider (use SES or SendGrid — confirm
  which env vars you expect from me)
- Queue all outbound mail through BullMQ, never send synchronously from a
  request handler
- Replace the console-logged OTP stub from Step 2 with real email sending,
  using a templated HTML layout
- Templates for: signup verification, password reset, and a placeholder
  "exam reminder" template (wired to real triggers once Step 7 exists)
- Retry with exponential backoff (up to 3 attempts) on send failure
- Delivery status logging against a mail record

When done, append an entry to PROGRESS_LOG.md confirming OTP emails now send
for real, and list which templates exist vs. are still placeholders.
```

---

## Step 6 — Question Bank & Question Set Upload

**Depends on:** Step 1, Step 4
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.11 (Question Set Upload & Modification), FR-11.1 through
FR-11.8:
- Manual question editor (admin UI) for both MCQ and coding questions, with
  all metadata fields (topic, difficulty, tags, options/test cases)
- Bulk upload via CSV/JSON with per-row validation and an error report
- Question versioning: edits create a new question_versions row, live
  question points to current_version
- Draft → pending_review → published approval workflow (Editor submits,
  Admin approves/rejects)
- Topic/tag taxonomy management screen

When done, append an entry to PROGRESS_LOG.md with the bulk-upload file
format you implemented (so the Content Acquisition Tool, a separate project,
can target it), and confirm how many sample questions exist in dev data.
```

---

## Step 7 — Virtual Interview & Exam Engine

**Depends on:** Step 3, Step 6
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.6 (Virtual Interview & Exam Module), FR-6.1 through FR-6.8:
- Admin: exam/template builder (sections, question selection, time limits,
  marking scheme) — replaces the Step 4 placeholder
- Candidate: pre-test instructions/consent screen, MCQ runtime (timer, mark
  for review, question palette), coding runtime (Monaco editor, language
  selector, run-against-sample-cases button — full grading comes in Step 8)
- Session persistence: save remaining time + answers server-side every N
  seconds so a dropped connection can resume
- Auto-submit on time expiry; manual submit with confirmation

When done, append an entry to PROGRESS_LOG.md describing the session-resume
mechanism in one or two sentences, since later modules (Proctoring, Step 14)
will hook into the same session lifecycle.
```

---

## Step 8 — Evaluation & Code Judge

**Depends on:** Step 7
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.7 (Evaluation & Code Judge Module), FR-7.1 through FR-7.8:
- MCQ auto-grading against the answer key with the exam's marking scheme
- Sandboxed code execution (Judge0 integration, or Dockerized runner if you
  set one up) with CPU/memory/time limits per language
- Run submissions against sample + hidden test cases, capture per-test-case
  verdicts (AC/WA/TLE/MLE/RE/CE)
- Async processing via BullMQ so submission spikes don't block the API;
  results delivered to the frontend via polling or WebSocket
- Partial scoring based on passed-test-case ratio where the exam allows it

When done, append an entry to PROGRESS_LOG.md confirming which languages are
supported end-to-end and the sandbox approach used.
```

---

## Step 9 — Scorecard Module

**Depends on:** Step 8
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.8 (Scorecard Module), FR-8.1 through FR-8.6:
- Compute and persist total score, percentage, and percentile once an
  attempt is fully evaluated
- Section/topic-wise breakdown
- Time-spent analysis per question/section
- Answer review screen (candidate's answer vs. correct answer, where allowed)
- Historical comparison chart against the candidate's past attempts of the
  same exam

Wire this into the Client Portal's "History/Scorecards" placeholder from
Step 3.

When done, append an entry to PROGRESS_LOG.md and mark the Step 3 placeholder
as now functional.
```

---

## Step 10 — Insights & Analytics

**Depends on:** Step 9
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.9 (Insights & Analytics Module), FR-9.1 through FR-9.7:
- Candidate-facing: strength/weakness radar by topic, computed from full
  attempt history
- Admin-facing: KPI dashboard (DAU/MAU, signups, active subscriptions,
  test volume) — replaces the Step 4 placeholder
- Question-quality analytics (attempt count, accuracy rate, avg time per
  question) as a background aggregation job updating question_stats
- CSV export for any analytics view

When done, append an entry to PROGRESS_LOG.md and mark the Step 4 admin
dashboard placeholder as now functional.
```

---

## Step 11 — Payment & Subscription

**Depends on:** Step 3, Step 4
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.10 (Payment & Subscription Module), FR-10.1 through FR-10.7:
- Plan management (admin CRUD on plans, feature flags stored as jsonb)
- Checkout flow via [Stripe or Razorpay — confirm which] hosted checkout,
  never touching raw card data
- Recurring billing, webhook handling (idempotent, keyed on gateway_ref),
  subscription status sync
- Feature-gating middleware checking active plan before granting premium
  access
- Invoice generation (PDF) and billing history page

Wire the "Subscription" placeholder from Step 3 and "Plan Configuration"/
"Transaction Oversight" placeholders from Step 4 to real functionality.

When done, append an entry to PROGRESS_LOG.md with the webhook endpoint URL
and idempotency key strategy used.
```

---

## Step 12 — AdSense / Advertising

**Depends on:** Step 3, Step 11
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §4.12 (AdSense Module), FR-12.1 through FR-12.6:
- ads_config-driven ad slot rendering on approved pages only (dashboard,
  practice list — never on any exam/interview/coding route)
- Subscriber ad suppression: check the plan's ads_free feature flag from
  Step 11 before rendering any ad container
- Admin ad-slot toggle screen, wiring the Step 4 "Ad Slot Configuration"
  placeholder

When done, append an entry to PROGRESS_LOG.md listing exactly which routes
are ad-eligible, so future modules never accidentally add ads to a
timed/proctored page.
```

---

## Step 13 — Audit Log & Security

**Depends on:** Step 4
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.8 (Audit Log & Security Module), FR-20.1 through FR-20.4:
- API rate limiting on sensitive endpoints (login, OTP, submissions)
- Audit logging middleware capturing privileged admin actions into
  audit_logs, wired to the Step 4 "Audit Log Viewer" placeholder
- Data export and account-deletion request handling (candidate-triggered)
- TLS/encryption-at-rest confirmation checklist for PII fields

When done, append an entry to PROGRESS_LOG.md listing which admin actions are
currently audited, so later modules add their own actions to this list rather
than building a second audit mechanism.
```

---

## Step 14 — Proctoring & Anti-Cheating

**Depends on:** Step 7
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.1 (Proctoring Module), FR-13.1 through FR-13.5, as an
opt-in layer on the exam session from Step 7 (only active when
exams.proctoring_enabled is true):
- Tab-switch/focus-loss detection, logged to attempts.proctoring_flags
- Full-screen enforcement with exit-attempt logging
- Copy-paste restriction in the code editor (configurable)
- Webcam snapshot capture at intervals (with explicit consent screen)
- Post-exam integrity report view for admins

When done, append an entry to PROGRESS_LOG.md describing where consent is
captured and confirm this doesn't affect non-proctored exam sessions.
```

---

## Step 15 — Notification Center (In-App/Push)

**Depends on:** Step 5
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.2 (Notification Center), FR-14.1 through FR-14.3:
- notifications table-backed in-app notification bell/feed
- Trigger notifications on: result-ready (Step 9), subscription-expiring
  (Step 11), admin announcements
- Per-category notification preferences screen in candidate settings
- (Optional/stretch) Web push for exam-start reminders

When done, append an entry to PROGRESS_LOG.md listing every event type that
currently triggers a notification.
```

---

## Step 16 — Discussion Forum

**Depends on:** Step 6
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.3 (Discussion Forum), FR-15.1 through FR-15.3:
- Per-question discussion thread (forum_posts/forum_comments) on the
  practice question detail page
- Upvoting
- Moderation actions (pin/hide/delete) available to Admin/Editor roles

When done, append an entry to PROGRESS_LOG.md.
```

---

## Step 17 — Gamification & Leaderboard

**Depends on:** Step 9
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.4 (Gamification Module), FR-16.1 through FR-16.4:
- Daily streak tracker on the candidate dashboard (replacing the Step 3
  placeholder widget)
- Badge catalog + a background job evaluating badge criteria and awarding
  user_badges
- Global and per-topic leaderboards
- (Optional/stretch) scheduled public contests

When done, append an entry to PROGRESS_LOG.md listing which badges exist in
dev data.
```

---

## Step 18 — CMS/Blog

**Depends on:** Step 4
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.5 (Content Management Module), FR-17.1 through FR-17.3:
- Admin/Editor article editor (markdown, SEO metadata fields)
- Public, paginated article listing + detail pages (SEO-friendly routes)
- Optional moderated comments

When done, append an entry to PROGRESS_LOG.md.
```

---

## Step 19 — Search & Filter

**Depends on:** Step 6
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.6 (Search & Filter Module), FR-18.1 through FR-18.3:
- Full-text search on the question bank using the search_vector/GIN index
  approach from the Database Module Design Document
- Combined filters: topic, difficulty, company tag, type, attempted status
- Global search bar (questions + articles; users, for admins only)

When done, append an entry to PROGRESS_LOG.md.
```

---

## Step 20 — Support/Helpdesk

**Depends on:** Step 2
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.7 (Support Module), FR-19.1 through FR-19.3:
- Candidate: raise-a-ticket form (category, description, attachment)
- Admin/Support: ticket queue, assignment, status updates, SLA-relevant
  resolved_at tracking
- Status-change notifications (wire into Step 15's notification system)

When done, append an entry to PROGRESS_LOG.md.
```

---

## Step 21 — B2B/Institute Reporting

**Depends on:** Step 4, Step 9
**Prompt:**
```
Read PROJECT_CONTEXT.md and PROGRESS_LOG.md first.

Implement FRD §5.9 (Reporting & Bulk Operations Module), FR-21.1 through
FR-21.3:
- Institute and institute_batches management (admin screen)
- Bulk candidate onboarding via CSV under a batch code
- Batch-level exam assignment and aggregated performance reporting/export

When done, append a final entry to PROGRESS_LOG.md summarizing the full
build — this closes out the core FRD module list.
```

---

## Notes

- **Separate track:** the Content Acquisition Tool (its own FRD) is intentionally not in this sequence — build it as an independent service once Step 6 is done, since it targets the same bulk-upload format that step defines.
- **If a module's session runs low on context mid-task:** don't restart from scratch — ask Claude to append a "handoff" entry to `PROGRESS_LOG.md` describing exactly what's done and what's left, then start a fresh session with the "First message" check-in above plus "continue Step N from PROGRESS_LOG.md."
- **Re-attach source docs sparingly:** you only need to attach the full FRD/DB Design Document again if a prompt references requirements not already summarized above — the summaries here are deliberately complete enough that most steps won't need the original files re-uploaded.
