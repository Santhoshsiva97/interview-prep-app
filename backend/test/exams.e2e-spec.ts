/**
 * Exam engine (FRD §4.6) against a real Postgres: builder + publish rules,
 * catalog, consent, autosave/resume, the server clock (pause vs strict,
 * timed sections), submit, the expiry sweep and code runs. Runs only with
 * E2E_DATABASE_URL.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import {
  ExamSessionLifecycle,
  type ExamSessionEvent,
} from '../src/modules/exams/services/exam-session-lifecycle.js';
import { ExamSessionService } from '../src/modules/exams/services/exam-session.service.js';
import { fakeConfig } from './utils/fake-config.js';
import { createTestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-exam.test';
const PREFIX = 'e2eexam';
const MIN = 60_000;

describe.skipIf(!DB_URL)('Exam engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: ExamSessionService;
  const events: ExamSessionEvent[] = [];
  const token: Record<string, string> = {};
  let topicId: string;
  const q: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token[who]}`);

  const cleanup = async () => {
    await prisma.examSession.deleteMany({
      where: { user: { email: { endsWith: DOMAIN } } },
    });
    await prisma.exam.deleteMany({ where: { title: { startsWith: PREFIX } } });
    await prisma.question.deleteMany({
      where: { topic: { slug: { startsWith: PREFIX } } },
    });
    await prisma.topic.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  };

  const liveQuestion = async (
    input: Record<string, unknown>,
    publish = true,
  ) => {
    const created = await as('editor', http().post('/api/v1/admin/questions'))
      .send({ body: 'Body', topicId, difficulty: 'easy', tagIds: [], ...input })
      .expect(201);
    if (publish) {
      await as(
        'editor',
        http().post(`/api/v1/admin/questions/${created.body.id}/submit`),
      ).expect(200);
      await as(
        'admin',
        http().post(`/api/v1/admin/questions/${created.body.id}/approve`),
      ).expect(200);
    }
    return created.body.id as string;
  };

  const examInput = (overrides: Record<string, unknown> = {}) => ({
    title: `${PREFIX} Mock`,
    instructions: 'Read carefully.',
    durationMinutes: 30,
    sections: [
      {
        title: 'Aptitude',
        negativeMarkPercent: 25,
        questionIds: [q.mcq1, q.mcq2],
      },
      { title: 'Coding', marksPerQuestion: 10, questionIds: [q.code] },
    ],
    ...overrides,
  });

  /** Creates and publishes an exam as admin; returns its id. */
  const publishedExam = async (overrides: Record<string, unknown> = {}) => {
    const res = await as('admin', http().post('/api/v1/admin/exams'))
      .send(examInput(overrides))
      .expect(201);
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${res.body.id}/publish`),
    ).expect(200);
    return res.body.id as string;
  };

  const start = async (examId: string, who = 'candidate') =>
    (
      await as(who, http().post(`/api/v1/exams/${examId}/sessions`))
        .send({ consent: true })
        .expect(201)
    ).body.sessionId as string;

  const resume = async (id: string, who = 'candidate') =>
    (
      await as(who, http().post(`/api/v1/exam-sessions/${id}/resume`)).expect(
        200,
      )
    ).body;

  /** Pretend the last server contact was `ms` ago. */
  const rewind = (id: string, ms: number) =>
    prisma.examSession.update({
      where: { id },
      data: { lastSyncedAt: new Date(Date.now() - ms) },
    });

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();
    const t = await createTestApp({ prisma });
    app = t.app;
    sessions = t.moduleRef.get(ExamSessionService);
    t.moduleRef.get(ExamSessionLifecycle).subscribe((e) => {
      events.push(e);
    });

    const roles: [string, UserRole][] = [
      ['candidate', 'candidate'],
      ['other', 'candidate'],
      ['support', 'support'],
      ['editor', 'editor'],
      ['admin', 'admin'],
    ];
    for (const [who, role] of roles) {
      const email = `${who}${DOMAIN}`;
      await prisma.user.create({
        data: {
          name: `Exam ${who}`,
          email,
          role,
          status: 'active',
          emailVerifiedAt: new Date(),
          passwordHash: await hash('secret123'),
        },
      });
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'secret123' });
      token[who] = res.body.accessToken;
    }

    const topic = await as('editor', http().post('/api/v1/admin/topics'))
      .send({ name: 'E2E Exams', slug: `${PREFIX}-topic` })
      .expect(201);
    topicId = topic.body.id;
    const mcq = (title: string) => ({
      type: 'mcq',
      title,
      marks: 2,
      mcq: {
        allowMultiple: false,
        options: [
          { text: 'Right', isCorrect: true },
          { text: 'Wrong', isCorrect: false },
        ],
      },
    });
    q.mcq1 = await liveQuestion(mcq('E2E exam MCQ one'));
    q.mcq2 = await liveQuestion(mcq('E2E exam MCQ two'));
    q.draft = await liveQuestion(mcq('E2E exam draft MCQ'), false);
    q.code = await liveQuestion({
      type: 'coding',
      title: 'E2E exam echo',
      marks: 5,
      coding: {
        timeLimitMs: 1000,
        memoryLimitMb: 128,
        starterCode: { python: 'print(input())' },
        testCases: [
          { input: 'hi', expectedOutput: 'hi', isSample: true, weight: 1 },
          {
            input: 'SECRET-IN',
            expectedOutput: 'SECRET-OUT',
            isSample: false,
            weight: 3,
          },
        ],
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('builder: RBAC, drafts can be incomplete, publish rules, admin-only changes once live', async () => {
    await as('candidate', http().get('/api/v1/admin/exams')).expect(403);
    await as('support', http().get('/api/v1/admin/exams')).expect(403);

    const draft = await as('editor', http().post('/api/v1/admin/exams'))
      .send(
        examInput({
          sections: [{ title: 'Only', questionIds: [q.mcq1, q.draft] }],
        }),
      )
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', questionCount: 2 });
    expect(draft.body.publishProblems).toEqual([
      {
        field: 'sections[0].questionIds[1]',
        message: 'This question has no published version yet',
      },
    ]);
    const id = draft.body.id;

    await as('editor', http().post(`/api/v1/admin/exams/${id}/publish`)).expect(
      403,
    );
    await as('admin', http().post(`/api/v1/admin/exams/${id}/publish`))
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_EXAM'));

    // Duplicates and unknown ids are rejected even for drafts.
    await as('editor', http().put(`/api/v1/admin/exams/${id}`))
      .send(
        examInput({
          sections: [{ title: 'A', questionIds: [q.mcq1, q.mcq1] }],
        }),
      )
      .expect(400)
      .expect(({ body }) =>
        expect(body.errors[0].field).toBe('sections[0].questionIds[1]'),
      );
    // Timed sections need limits; total time is the sum.
    await as('editor', http().put(`/api/v1/admin/exams/${id}`))
      .send(examInput({ sectionTimed: true }))
      .expect(400);
    const timed = await as('editor', http().put(`/api/v1/admin/exams/${id}`))
      .send(
        examInput({
          sectionTimed: true,
          sections: [
            { title: 'A', durationMinutes: 7, questionIds: [q.mcq1] },
            {
              title: 'B',
              durationMinutes: 8,
              marksPerQuestion: 10,
              questionIds: [q.code],
            },
          ],
        }),
      )
      .expect(200);
    expect(timed.body).toMatchObject({
      durationMinutes: 15,
      totalMarks: 12,
      publishProblems: [],
    });
    expect(timed.body.sections[1].items[0]).toMatchObject({
      questionId: q.code,
      marks: 10,
      pinnedVersion: 1,
      liveVersion: 1,
    });

    await as('admin', http().post(`/api/v1/admin/exams/${id}/publish`)).expect(
      200,
    );
    await as('editor', http().put(`/api/v1/admin/exams/${id}`))
      .send(examInput())
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe('PUBLISHED_EXAM_ADMIN_ONLY'),
      );
    // Admins can't make a live exam unpublishable.
    await as('admin', http().put(`/api/v1/admin/exams/${id}`))
      .send(examInput({ sections: [{ title: 'A', questionIds: [q.draft] }] }))
      .expect(400);

    const list = await as(
      'editor',
      http().get(`/api/v1/admin/exams?search=${PREFIX}`),
    ).expect(200);
    expect(
      list.body.items.find((e: { id: string }) => e.id === id),
    ).toMatchObject({
      status: 'published',
      sectionTimed: true,
      questionCount: 2,
    });

    // Drafts nobody attempted can be deleted.
    const scrap = await as('editor', http().post('/api/v1/admin/exams'))
      .send(examInput({ title: `${PREFIX} scrap`, sections: [] }))
      .expect(201);
    await as(
      'editor',
      http().delete(`/api/v1/admin/exams/${scrap.body.id}`),
    ).expect(204);
    await as(
      'editor',
      http().get(`/api/v1/admin/exams/${scrap.body.id}`),
    ).expect(404);
  });

  it('candidate: catalog, consent, one attempt at a time, no answer keys', async () => {
    const examId = await publishedExam({ title: `${PREFIX} Catalog` });
    const catalog = await as('candidate', http().get('/api/v1/exams')).expect(
      200,
    );
    expect(
      catalog.body.find((e: { id: string }) => e.id === examId),
    ).toMatchObject({
      questionCount: 3,
      totalMarks: 14,
      hasCoding: true,
      attemptsUsed: 0,
      inProgressSessionId: null,
      canStart: true,
    });
    const detail = await as(
      'candidate',
      http().get(`/api/v1/exams/${examId}`),
    ).expect(200);
    expect(detail.body.sections[0]).toMatchObject({
      questionCount: 2,
      mcqCount: 2,
      marks: 4,
      negativeMarkPercent: 25,
    });

    await as('candidate', http().post(`/api/v1/exams/${examId}/sessions`))
      .send({ consent: false })
      .expect(400);
    const sessionId = await start(examId);
    const again = await as(
      'candidate',
      http().post(`/api/v1/exams/${examId}/sessions`),
    )
      .send({ consent: true })
      .expect(200);
    expect(again.body).toEqual({ sessionId, resumed: true });

    const s = await resume(sessionId);
    expect(s).toMatchObject({
      status: 'in_progress',
      totalMarks: 14,
      attemptNumber: 1,
    });
    expect(s.items).toHaveLength(3);
    expect(s.timeRemainingMs).toBeGreaterThan(29 * MIN);
    const json = JSON.stringify(s);
    expect(json).not.toContain('isCorrect');
    expect(json).not.toContain('SECRET');
    const coding = s.items.find((i: { type: string }) => i.type === 'coding');
    expect(coding.marks).toBe(10);
    expect(coding.question.coding.sampleTestCases).toEqual([
      { input: 'hi', expectedOutput: 'hi' },
    ]);

    // Other candidates can't see or touch it.
    await as(
      'other',
      http().post(`/api/v1/exam-sessions/${sessionId}/resume`),
    ).expect(404);
    await as('other', http().patch(`/api/v1/exam-sessions/${sessionId}`))
      .send({ answers: [] })
      .expect(404);

    // Unpublished exams disappear from the catalog.
    const draft = await as('editor', http().post('/api/v1/admin/exams'))
      .send(examInput({ title: `${PREFIX} Hidden` }))
      .expect(201);
    await as('candidate', http().get(`/api/v1/exams/${draft.body.id}`)).expect(
      404,
    );
    await as(
      'candidate',
      http().post(`/api/v1/exams/${draft.body.id}/sessions`),
    )
      .send({ consent: true })
      .expect(404);

    const list = await as('candidate', http().get('/api/v1/exams')).expect(200);
    expect(
      list.body.find((e: { id: string }) => e.id === examId),
    ).toMatchObject({
      inProgressSessionId: sessionId,
      attemptsUsed: 1,
    });
  });

  it('autosave + resume restores answers, review flags and time; bad answers are reported, not fatal', async () => {
    const examId = await publishedExam({ title: `${PREFIX} Resume` });
    const id = await start(examId);
    const s = await resume(id);
    const [m1, m2] = s.items.filter((i: { type: string }) => i.type === 'mcq');
    const code = s.items.find((i: { type: string }) => i.type === 'coding');

    const saved = await as(
      'candidate',
      http().patch(`/api/v1/exam-sessions/${id}`),
    )
      .send({
        answers: [
          {
            itemId: m1.id,
            response: { optionIds: [m1.question.mcq.options[0].id] },
            visited: true,
            timeSpentMs: 4000,
          },
          { itemId: m2.id, markedForReview: true, visited: true },
          {
            itemId: code.id,
            response: {
              language: 'python',
              sources: { python: 'print(input())', javascript: '// later' },
            },
          },
          { itemId: m2.id, response: { optionIds: ['nope'] } },
          { itemId: '00000000-0000-4000-8000-000000000000', response: null },
        ],
      })
      .expect(200);
    expect(saved.body).toMatchObject({ status: 'in_progress' });
    expect(saved.body.rejected).toEqual([
      expect.objectContaining({ itemId: m2.id, code: 'INVALID_ANSWER' }),
      expect.objectContaining({ code: 'ITEM_NOT_FOUND' }),
    ]);

    // "Connection drops", then the page reloads.
    const after = await resume(id);
    const byId = new Map(after.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.get(m1.id)).toMatchObject({
      answered: true,
      visited: true,
      response: { optionIds: [m1.question.mcq.options[0].id] },
    });
    expect(byId.get(m2.id)).toMatchObject({
      answered: false,
      markedForReview: true,
    });
    expect(byId.get(code.id)).toMatchObject({
      answered: true,
      response: { language: 'python', sources: { javascript: '// later' } },
    });

    // Clearing an answer.
    await as('candidate', http().patch(`/api/v1/exam-sessions/${id}`))
      .send({ answers: [{ itemId: m1.id, response: null }] })
      .expect(200);
    expect(
      (await resume(id)).items.find((i: { id: string }) => i.id === m1.id),
    ).toMatchObject({
      answered: false,
      response: null,
    });
  });

  it('pause-on-disconnect: a dropped connection costs only the grace, and is logged as resumed', async () => {
    const examId = await publishedExam({ title: `${PREFIX} Pause` });
    const id = await start(examId);
    await resume(id);
    const before = await prisma.examSession.findUniqueOrThrow({
      where: { id },
    });
    await rewind(id, 10 * MIN);
    events.length = 0;

    const s = await resume(id);
    // Grace is 45 s by default; allow for request time.
    const charged = before.timeRemainingMs - s.timeRemainingMs;
    expect(charged).toBeGreaterThanOrEqual(45_000);
    expect(charged).toBeLessThan(50_000);
    expect(s.status).toBe('in_progress');
    expect(events.map((e) => e.type)).toEqual(['resumed']);
    const logged = await prisma.examSessionEvent.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logged.map((e) => e.type)).toEqual(['started', 'resumed']);
  });

  it('strict clock: time keeps running offline and the next contact auto-submits', async () => {
    const examId = await publishedExam({
      title: `${PREFIX} Strict`,
      pauseOnDisconnect: false,
      durationMinutes: 5,
    });
    const id = await start(examId);
    const s = await resume(id);
    await rewind(id, 6 * MIN);

    const res = await as(
      'candidate',
      http().patch(`/api/v1/exam-sessions/${id}`),
    )
      .send({ answers: [{ itemId: s.items[0].id, markedForReview: true }] })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'submitted',
      submitReason: 'time_expired',
      timeRemainingMs: 0,
    });
    await as('candidate', http().patch(`/api/v1/exam-sessions/${id}`))
      .send({ answers: [] })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          code: 'SESSION_CLOSED',
          submitReason: 'time_expired',
        }),
      );
    // After submission the questions are no longer served.
    const view = await as(
      'candidate',
      http().get(`/api/v1/exam-sessions/${id}`),
    ).expect(200);
    expect(
      view.body.items.every((i: { question: unknown }) => i.question === null),
    ).toBe(true);
  });

  it('sweep closes strict attempts that ran out and pause attempts abandoned for a day, and nothing else', async () => {
    const strictExam = await publishedExam({
      title: `${PREFIX} Sweep strict`,
      pauseOnDisconnect: false,
      durationMinutes: 5,
    });
    const pauseExam = await publishedExam({ title: `${PREFIX} Sweep pause` });
    const pauseExam2 = await publishedExam({
      title: `${PREFIX} Sweep pause 2`,
    });
    const expired = await start(strictExam);
    const abandoned = await start(pauseExam);
    const away = await start(pauseExam2);
    await rewind(expired, 6 * MIN);
    await rewind(abandoned, 25 * 3600_000);
    await rewind(away, 30 * MIN);

    await sessions.sweep();
    const rows = await prisma.examSession.findMany({
      where: { id: { in: [expired, abandoned, away] } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(expired)).toMatchObject({
      status: 'submitted',
      submitReason: 'time_expired',
    });
    expect(byId.get(abandoned)).toMatchObject({
      status: 'submitted',
      submitReason: 'abandoned',
    });
    expect(byId.get(away)).toMatchObject({ status: 'in_progress' });
  });

  it('timed sections: only the current section is open; finishing one locks it; the last one submits', async () => {
    const examId = await publishedExam({
      title: `${PREFIX} Sections`,
      sectionTimed: true,
      sections: [
        { title: 'One', durationMinutes: 10, questionIds: [q.mcq1] },
        { title: 'Two', durationMinutes: 20, questionIds: [q.mcq2] },
      ],
    });
    const id = await start(examId);
    const s = await resume(id);
    expect(s).toMatchObject({
      currentSectionIndex: 0,
      exam: { durationMinutes: 30 },
    });
    expect(s.sectionRemainingMs).toBeLessThanOrEqual(10 * MIN);
    expect(s.sections.map((x: { state: string }) => x.state)).toEqual([
      'current',
      'upcoming',
    ]);
    const [one, two] = s.items;
    expect(one.question).not.toBeNull();
    expect(two.question).toBeNull();

    const early = await as(
      'candidate',
      http().patch(`/api/v1/exam-sessions/${id}`),
    )
      .send({ answers: [{ itemId: two.id, markedForReview: true }] })
      .expect(200);
    expect(early.body.rejected).toEqual([
      expect.objectContaining({ itemId: two.id, code: 'SECTION_LOCKED' }),
    ]);

    const next = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${id}/next-section`),
    )
      .send({
        answers: [
          {
            itemId: one.id,
            response: { optionIds: [one.question.mcq.options[0].id] },
          },
        ],
      })
      .expect(200);
    expect(next.body).toMatchObject({
      status: 'in_progress',
      currentSectionIndex: 1,
    });
    // Section one's leftover time is forfeited.
    expect(next.body.timeRemainingMs).toBe(20 * MIN);

    const s2 = await resume(id);
    expect(s2.sections.map((x: { state: string }) => x.state)).toEqual([
      'done',
      'current',
    ]);
    expect(s2.items[0]).toMatchObject({ answered: true, question: null });
    const late = await as(
      'candidate',
      http().patch(`/api/v1/exam-sessions/${id}`),
    )
      .send({ answers: [{ itemId: one.id, response: null }] })
      .expect(200);
    expect(late.body.rejected[0].code).toBe('SECTION_LOCKED');

    const done = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${id}/next-section`),
    )
      .send({})
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'submitted',
      submitReason: 'manual',
    });
  });

  it('submit: final answers are saved, attempts are limited, and exam edits never touch a running attempt', async () => {
    const examId = await publishedExam({
      title: `${PREFIX} Submit`,
      maxAttempts: 1,
    });
    const id = await start(examId);
    const s = await resume(id);
    const mcq = s.items.find((i: { type: string }) => i.type === 'mcq');

    // Admin edits the live exam mid-attempt: the attempt keeps its copy.
    await as('admin', http().put(`/api/v1/admin/exams/${examId}`))
      .send(
        examInput({
          title: `${PREFIX} Submit`,
          maxAttempts: 1,
          sections: [{ title: 'New', questionIds: [q.mcq1] }],
        }),
      )
      .expect(200);
    expect((await resume(id)).items).toHaveLength(3);

    // A client whose timer ran out early doesn't lose the server's remaining time.
    const early = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${id}/submit`),
    )
      .send({ auto: true })
      .expect(200);
    expect(early.body.status).toBe('in_progress');
    expect(early.body.timeRemainingMs).toBeGreaterThan(29 * MIN);

    events.length = 0;
    const res = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${id}/submit`),
    )
      .send({
        answers: [
          {
            itemId: mcq.id,
            response: { optionIds: [mcq.question.mcq.options[1].id] },
          },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'submitted',
      submitReason: 'manual',
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'submitted',
        sessionId: id,
        data: { reason: 'manual' },
      }),
    ]);
    const item = await prisma.examSessionItem.findUniqueOrThrow({
      where: { id: mcq.id },
    });
    expect(item.response).toEqual({
      optionIds: [mcq.question.mcq.options[1].id],
    });

    await as('candidate', http().post(`/api/v1/exam-sessions/${id}/submit`))
      .send({})
      .expect(409);
    await as('candidate', http().post(`/api/v1/exams/${examId}/sessions`))
      .send({ consent: true })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ATTEMPT_LIMIT_REACHED'));

    const mine = await as(
      'candidate',
      http().get('/api/v1/exam-sessions'),
    ).expect(200);
    expect(mine.body.find((m: { id: string }) => m.id === id)).toMatchObject({
      status: 'submitted',
      title: `${PREFIX} Submit`,
      questionCount: 3,
    });

    // An exam with attempts can't be deleted, only archived.
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${examId}/unpublish`),
    ).expect(200);
    await as('admin', http().delete(`/api/v1/admin/exams/${examId}`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('EXAM_HAS_ATTEMPTS'));
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${examId}/archive`),
    ).expect(200);
  });

  it('run: sample cases only, coding questions only, with a cooldown (runner disabled by default)', async () => {
    const examId = await publishedExam({ title: `${PREFIX} Run` });
    const id = await start(examId);
    const s = await resume(id);
    const code = s.items.find((i: { type: string }) => i.type === 'coding');
    const mcq = s.items.find((i: { type: string }) => i.type === 'mcq');

    const run = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${id}/run`),
    )
      .send({ itemId: code.id, language: 'python', code: 'print(input())' })
      .expect(200);
    expect(run.body).toMatchObject({ status: 'unavailable', results: [] });
    expect(run.body.message).toMatch(/isn’t available/);

    await as('candidate', http().post(`/api/v1/exam-sessions/${id}/run`))
      .send({ itemId: code.id, language: 'python', code: 'x' })
      .expect(429)
      .expect(({ body }) => expect(body.code).toBe('RUN_COOLDOWN'));
    await as('candidate', http().post(`/api/v1/exam-sessions/${id}/run`))
      .send({ itemId: mcq.id, language: 'python', code: 'x' })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('NOT_CODING_QUESTION'));
    await as('candidate', http().post(`/api/v1/exam-sessions/${id}/run`))
      .send({ itemId: code.id, language: 'ruby', code: 'x' })
      .expect(400);
  });
});
