/**
 * Scorecards (FRD §4.8) against a real Postgres: built when grading finishes,
 * section/topic breakdowns, percentile against first attempts, time analysis,
 * answer review per the exam's policy, history of attempts, access rules and
 * the dashboard's recent activity. Runs only with E2E_DATABASE_URL.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import type { JudgeJob } from '../src/modules/judge/models/judge.model.js';
import { fakeConfig } from './utils/fake-config.js';
import type { FakeQueue } from './utils/fake-mail.js';
import { ScriptedRunner } from './utils/scripted-runner.js';
import { createTestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-score.test';
const PREFIX = 'e2escore';

type Policy = 'full' | 'own_answers' | 'none';

describe.skipIf(!DB_URL)('Scorecards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: FakeQueue<JudgeJob>;
  const runner = new ScriptedRunner();
  const token: Record<string, string> = {};
  const q: Record<string, string> = {};
  const topic: Record<string, string> = {};

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

  const liveQuestion = async (input: Record<string, unknown>) => {
    const created = await as('editor', http().post('/api/v1/admin/questions'))
      .send({ body: 'Body text', difficulty: 'easy', tagIds: [], ...input })
      .expect(201);
    const id = created.body.id as string;
    await as(
      'editor',
      http().post(`/api/v1/admin/questions/${id}/submit`),
    ).expect(200);
    await as(
      'admin',
      http().post(`/api/v1/admin/questions/${id}/approve`),
    ).expect(200);
    return id;
  };

  const exam = async (answerReview: Policy = 'full') => {
    const res = await as('admin', http().post('/api/v1/admin/exams'))
      .send({
        title: `${PREFIX} ${answerReview}`,
        instructions: 'Go.',
        durationMinutes: 30,
        passPercent: 50,
        answerReview,
        sections: [
          {
            title: 'Theory',
            negativeMarkPercent: 25,
            questionIds: [q.mcq1, q.mcq2],
          },
          { title: 'Practice', marksPerQuestion: 10, questionIds: [q.code] },
        ],
      })
      .expect(201);
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${res.body.id}/publish`),
    ).expect(200);
    return res.body.id as string;
  };

  /** Takes and submits an attempt, then runs grading. */
  const take = async (
    examId: string,
    who: string,
    plan: { mcq1?: 'Right' | 'Wrong'; mcq2?: 'Right' | 'Wrong'; code?: string },
    timeSpentMs = 0,
  ) => {
    const { body } = await as(
      who,
      http().post(`/api/v1/exams/${examId}/sessions`),
    )
      .send({ consent: true })
      .expect(201);
    const id = body.sessionId as string;
    const s = await as(
      who,
      http().post(`/api/v1/exam-sessions/${id}/resume`),
    ).expect(200);
    type Item = {
      id: string;
      type: string;
      question: {
        title: string;
        mcq?: { options: { id: string; text: string }[] };
      };
    };
    const items = s.body.items as Item[];
    const byTitle = (t: string) => items.find((i) => i.question.title === t)!;
    const mcq = (i: Item, text: string) => ({
      itemId: i.id,
      response: {
        optionIds: [i.question.mcq!.options.find((o) => o.text === text)!.id],
      },
    });
    const answers: Record<string, unknown>[] = [];
    if (plan.mcq1) answers.push(mcq(byTitle('Score MCQ one'), plan.mcq1));
    if (plan.mcq2) answers.push(mcq(byTitle('Score MCQ two'), plan.mcq2));
    if (plan.code)
      answers.push({
        itemId: byTitle('Score echo').id,
        response: { language: 'python', sources: { python: plan.code } },
      });
    // Time on the first question (the server caps it at the time actually elapsed).
    if (timeSpentMs) {
      await prisma.examSession.update({
        where: { id },
        data: { lastSyncedAt: new Date(Date.now() - timeSpentMs - 5000) },
      });
      answers.push({ itemId: items[0].id, timeSpentMs });
    }
    await as(who, http().post(`/api/v1/exam-sessions/${id}/submit`))
      .send({ answers })
      .expect(200);
    await queue.drain();
    return id;
  };

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();
    const t = await createTestApp({ prisma, codeRunner: runner });
    app = t.app;
    queue = t.judgeQueue;

    const roles: [string, UserRole][] = [
      ['alice', 'candidate'],
      ['bob', 'candidate'],
      ['carol', 'candidate'],
      ['support', 'support'],
      ['editor', 'editor'],
      ['admin', 'admin'],
    ];
    for (const [who, role] of roles) {
      const email = `${who}${DOMAIN}`;
      await prisma.user.create({
        data: {
          name: `Score ${who}`,
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
    for (const name of ['Logic', 'Coding']) {
      const res = await as('editor', http().post('/api/v1/admin/topics'))
        .send({ name: `E2E ${name}`, slug: `${PREFIX}-${name.toLowerCase()}` })
        .expect(201);
      topic[name] = res.body.id;
    }
    const mcq = (title: string) => ({
      type: 'mcq',
      title,
      topicId: topic.Logic,
      marks: 2,
      explanation: `Why: ${title}`,
      mcq: {
        allowMultiple: false,
        options: [
          { text: 'Right', isCorrect: true },
          { text: 'Wrong', isCorrect: false },
        ],
      },
    });
    q.mcq1 = await liveQuestion(mcq('Score MCQ one'));
    q.mcq2 = await liveQuestion(mcq('Score MCQ two'));
    q.code = await liveQuestion({
      type: 'coding',
      title: 'Score echo',
      topicId: topic.Coding,
      marks: 5,
      coding: {
        timeLimitMs: 1000,
        memoryLimitMb: 128,
        testCases: [
          { input: 'one', expectedOutput: 'one', isSample: true, weight: 1 },
          {
            input: 'HIDDEN-two',
            expectedOutput: 'HIDDEN-two',
            isSample: false,
            weight: 2,
          },
          {
            input: 'HIDDEN-three',
            expectedOutput: 'never',
            isSample: false,
            weight: 1,
          },
        ],
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('built on grading: totals, pass mark, sections, topics (weakest first), time analysis', async () => {
    const examId = await exam('full');
    const id = await take(
      examId,
      'alice',
      { mcq1: 'Right', mcq2: 'Wrong', code: 'echo' },
      30_000,
    );

    const row = await prisma.scorecard.findUniqueOrThrow({
      where: { sessionId: id },
    });
    // +2 −0.5 + 10 × ¾ = 9 of 14
    expect(row).toMatchObject({
      scoreCenti: 900,
      maxScoreCenti: 1400,
      percentBp: 6429,
      passed: true,
    });

    const { body } = await as(
      'alice',
      http().get(`/api/v1/scorecards/${id}`),
    ).expect(200);
    expect(body.scorecard).toMatchObject({
      score: 9,
      maxScore: 14,
      percent: 64.29,
      passed: true,
      percentile: 50, // alone in the cohort
      cohortSize: 1,
    });
    expect(body.scorecard.sections).toEqual([
      expect.objectContaining({
        title: 'Theory',
        score: 1.5,
        maxScore: 4,
        correct: 1,
        incorrect: 1,
        percent: 37.5,
      }),
      expect.objectContaining({
        title: 'Practice',
        score: 7.5,
        maxScore: 10,
        partial: 1,
        percent: 75,
      }),
    ]);
    expect(
      body.scorecard.topics.map((t: { name: string; percent: number }) => [
        t.name,
        t.percent,
      ]),
    ).toEqual([
      ['E2E Logic', 37.5],
      ['E2E Coding', 75],
    ]);
    expect(body.questions).toHaveLength(3);
    expect(body.questions[0]).toMatchObject({
      number: 1,
      sectionTitle: 'Theory',
      timeSpentMs: 30_000,
    });
    expect(body.scorecard.timeSpentMs).toBe(30_000);
    expect(body.scorecard.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('percentile compares against other candidates’ first attempts; history lists my attempts', async () => {
    const examId = await exam('full');
    const bob1 = await take(examId, 'bob', { mcq1: 'Right' }); // 2
    await take(examId, 'carol', { mcq1: 'Right', mcq2: 'Right', code: 'echo' }); // 11.5
    const bob2 = await take(examId, 'bob', { mcq1: 'Wrong', mcq2: 'Wrong' }); // -1 → 0%

    const second = await as(
      'bob',
      http().get(`/api/v1/scorecards/${bob2}`),
    ).expect(200);
    expect(second.body.scorecard).toMatchObject({
      score: -1,
      percent: 0,
      passed: false,
    });
    // Cohort = first attempts {2, 11.5} + this retake (-1): nobody lower.
    expect(second.body.scorecard).toMatchObject({
      percentile: 16.67,
      cohortSize: 3,
    });
    expect(second.body.history).toEqual([
      expect.objectContaining({
        sessionId: bob1,
        attemptNumber: 1,
        score: 2,
        current: false,
      }),
      expect.objectContaining({
        sessionId: bob2,
        attemptNumber: 2,
        score: -1,
        percent: 0,
        current: true,
      }),
    ]);

    // Bob's first attempt was graded when he was alone; it's refreshed now carol is in.
    const first = await as(
      'bob',
      http().get(`/api/v1/scorecards/${bob1}`),
    ).expect(200);
    expect(first.body.scorecard).toMatchObject({
      percentile: 25,
      cohortSize: 2,
    });

    const list = await as('bob', http().get('/api/v1/scorecards')).expect(200);
    expect(list.body.map((a: { sessionId: string }) => a.sessionId)).toEqual([
      bob2,
      bob1,
    ]);
    expect(list.body[0]).toMatchObject({
      attemptNumber: 2,
      gradingStatus: 'graded',
      result: { score: -1 },
    });
  });

  it('answer review follows the exam’s policy; hidden tests are never shown', async () => {
    const plan = { mcq1: 'Wrong' as const, code: 'echo' };
    const full = await take(await exam('full'), 'carol', plan);
    const own = await take(await exam('own_answers'), 'carol', plan);
    const none = await take(await exam('none'), 'carol', plan);
    const get = async (id: string) =>
      (await as('carol', http().get(`/api/v1/scorecards/${id}`)).expect(200))
        .body as {
        exam: { answerReview: Policy };
        questions: {
          title: string;
          outcome: string;
          review: null | {
            explanation: string | null;
            options:
              | { text: string; chosen: boolean; isCorrect: boolean | null }[]
              | null;
            code: null | {
              source: string;
              hiddenPassed: number;
              hiddenTotal: number;
              samples: { input: string; output: string }[];
            };
          };
        }[];
      };

    const f = await get(full);
    const fm = f.questions.find((x) => x.title === 'Score MCQ one')!;
    expect(fm.outcome).toBe('incorrect');
    expect(fm.review).toMatchObject({
      explanation: 'Why: Score MCQ one',
      options: expect.arrayContaining([
        {
          id: expect.any(String),
          text: 'Wrong',
          chosen: true,
          isCorrect: false,
        },
        {
          id: expect.any(String),
          text: 'Right',
          chosen: false,
          isCorrect: true,
        },
      ]),
    });
    const fc = f.questions.find((x) => x.title === 'Score echo')!.review!.code!;
    expect(fc).toMatchObject({
      source: 'echo',
      hiddenPassed: 1,
      hiddenTotal: 2,
    });
    expect(fc.samples).toEqual([
      expect.objectContaining({ input: 'one', output: 'one\n' }),
    ]);
    expect(JSON.stringify(f)).not.toContain('HIDDEN');

    const o = await get(own);
    expect(o.exam.answerReview).toBe('own_answers');
    const om = o.questions.find((x) => x.title === 'Score MCQ one')!.review!;
    expect(om.explanation).toBeNull();
    expect(om.options!.every((x) => x.isCorrect === null)).toBe(true);
    expect(om.options!.find((x) => x.text === 'Wrong')!.chosen).toBe(true);
    expect(
      o.questions.find((x) => x.title === 'Score echo')!.review!.code!.samples,
    ).toEqual([]);

    const n = await get(none);
    expect(n.questions.every((x) => x.review === null)).toBe(true);
    expect(n.questions.map((x) => x.outcome)).toContain('incorrect');
  });

  it('access: owner and admin/support only; ungraded attempts have no scorecard yet; missing ones are rebuilt', async () => {
    const examId = await exam('full');
    const id = await take(examId, 'alice', { mcq1: 'Right' });
    await as('bob', http().get(`/api/v1/scorecards/${id}`)).expect(404);
    await as('support', http().get(`/api/v1/scorecards/${id}`)).expect(200);

    // The `graded` hook was missed: the scorecard is built on first view.
    await prisma.scorecard.delete({ where: { sessionId: id } });
    const rebuilt = await as(
      'alice',
      http().get(`/api/v1/scorecards/${id}`),
    ).expect(200);
    expect(rebuilt.body.scorecard).toMatchObject({ score: 2 });

    // Grading still running: listed, but no result and no review yet.
    runner.mode = 'throw';
    const pending = await take(examId, 'alice', { code: 'echo' });
    runner.mode = 'ok';
    await prisma.examSession.update({
      where: { id: pending },
      data: { gradingStatus: 'grading' },
    });
    const view = await as(
      'alice',
      http().get(`/api/v1/scorecards/${pending}`),
    ).expect(200);
    expect(view.body).toMatchObject({
      gradingStatus: 'grading',
      scorecard: null,
    });
    expect(
      view.body.questions.every(
        (x: { review: unknown; outcome: unknown }) =>
          x.review === null && x.outcome === null,
      ),
    ).toBe(true);
    const list = await as('alice', http().get('/api/v1/scorecards')).expect(
      200,
    );
    expect(
      list.body.find((a: { sessionId: string }) => a.sessionId === pending),
    ).toMatchObject({ result: null });

    // In-progress attempts aren't scorecards.
    const { body } = await as(
      'alice',
      http().post(`/api/v1/exams/${examId}/sessions`),
    )
      .send({ consent: true })
      .expect(201);
    await as(
      'alice',
      http().get(`/api/v1/scorecards/${body.sessionId}`),
    ).expect(404);
  });

  it('dashboard recent activity lists graded attempts with their score', async () => {
    const { body } = await as('carol', http().get('/api/v1/dashboard')).expect(
      200,
    );
    expect(body.recentActivity.status).toBe('live');
    expect(body.recentActivity.data.length).toBeGreaterThan(0);
    expect(body.recentActivity.data[0]).toMatchObject({
      type: 'exam',
      title: expect.stringContaining(PREFIX),
      result: expect.stringMatching(/\/ 14 \(\d+%\)$/),
    });
  });
});
