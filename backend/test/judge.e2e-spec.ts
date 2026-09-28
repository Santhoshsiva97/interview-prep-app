/**
 * Evaluation & code judge (FRD §4.7) against a real Postgres: queued runs
 * polled by the client, grading on submit (MCQ marking scheme, coding
 * partial scores), judge outages with retries, regrading, staff reports.
 * The code runner is scripted (see ScriptedRunner) so verdicts are
 * deterministic; the Judge0 client itself is unit-tested. Runs only with
 * E2E_DATABASE_URL.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/database/redis.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import { ExamSessionService } from '../src/modules/exams/services/exam-session.service.js';
import { JudgeService } from '../src/modules/judge/services/judge.service.js';
import type { JudgeJob } from '../src/modules/judge/models/judge.model.js';
import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
} from '../src/modules/judge/runners/code-runner.js';
import { fakeConfig } from './utils/fake-config.js';
import type { FakeQueue } from './utils/fake-mail.js';
import { createTestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-judge.test';
const PREFIX = 'e2ejudge';
const MIN = 60_000;

/**
 * The "program" is the source text: `echo` prints its input, `wrong` prints
 * junk, `ce` doesn't compile, `tle` loops forever. `mode` simulates the
 * judge being down (`throw`) or not configured (`unavailable`).
 */
class ScriptedRunner implements CodeRunner {
  readonly name = 'scripted';
  mode: 'ok' | 'throw' | 'unavailable' = 'ok';
  calls: CodeRunRequest[] = [];

  run(req: CodeRunRequest): Promise<CodeRunResult> {
    this.calls.push(req);
    if (this.mode === 'throw')
      return Promise.reject(new Error('Judge0 POST /submissions/batch → 503'));
    if (this.mode === 'unavailable')
      return Promise.resolve({
        status: 'unavailable',
        message: 'Running code isn’t available on this server.',
        outcomes: [],
      });
    const program = req.source.trim();
    const run = (input: string) => {
      const base = { stderr: '', timeMs: 5, memoryKb: 1024 };
      if (program === 'ce')
        return { ...base, status: 'compile_error' as const, stdout: '' };
      if (program === 'tle')
        return { ...base, status: 'time_limit' as const, stdout: '' };
      return {
        ...base,
        status: 'ok' as const,
        stdout: program === 'echo' ? `${input}\n` : 'junk\n',
      };
    };
    return Promise.resolve({
      status: 'completed',
      compileOutput: program === 'ce' ? 'error: expected ;' : null,
      outcomes: req.inputs.map(run),
    });
  }
}

describe.skipIf(!DB_URL)('Code judge & grading (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let sessions: ExamSessionService;
  let judge: JudgeService;
  let queue: FakeQueue<JudgeJob>;
  const runner = new ScriptedRunner();
  const token: Record<string, string> = {};
  const q: Record<string, string> = {};
  let topicId: string;

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
      .send({ body: 'Body', topicId, difficulty: 'easy', tagIds: [], ...input })
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

  const exam = async (overrides: { partialScoring?: boolean } = {}) => {
    const res = await as('admin', http().post('/api/v1/admin/exams'))
      .send({
        title: `${PREFIX} Exam`,
        instructions: 'Go.',
        durationMinutes: 30,
        pauseOnDisconnect: false,
        sections: [
          {
            title: 'MCQ',
            negativeMarkPercent: 25,
            questionIds: [q.mcq1, q.mcq2],
          },
          {
            title: 'Code',
            marksPerQuestion: 10,
            partialScoring: overrides.partialScoring ?? true,
            questionIds: [q.code],
          },
        ],
      })
      .expect(201);
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${res.body.id}/publish`),
    ).expect(200);
    return res.body.id as string;
  };

  /** Starts an attempt and returns its items keyed by type. */
  const attempt = async (examId: string, who = 'candidate') => {
    const { body } = await as(
      who,
      http().post(`/api/v1/exams/${examId}/sessions`),
    )
      .send({ consent: true })
      .expect(201);
    const s = await as(
      who,
      http().post(`/api/v1/exam-sessions/${body.sessionId}/resume`),
    ).expect(200);
    const mcqs = s.body.items.filter((i: { type: string }) => i.type === 'mcq');
    const code = s.body.items.find(
      (i: { type: string }) => i.type === 'coding',
    );
    return { id: body.sessionId as string, mcqs, code };
  };

  /** Option id with the given text (option order may be shuffled). */
  const option = (
    item: { question: { mcq: { options: { id: string; text: string }[] } } },
    text: string,
  ) => item.question.mcq.options.find((o) => o.text === text)!.id;

  const coolDown = (sessionId: string) => redis.del(`exam:run:${sessionId}`);

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();
    const t = await createTestApp({ prisma, codeRunner: runner });
    app = t.app;
    queue = t.judgeQueue;
    redis = t.moduleRef.get(RedisService);
    sessions = t.moduleRef.get(ExamSessionService);
    judge = t.moduleRef.get(JudgeService);

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
          name: `Judge ${who}`,
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
      .send({ name: 'E2E Judge', slug: `${PREFIX}-topic` })
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
    q.mcq1 = await liveQuestion(mcq('Judge MCQ one'));
    q.mcq2 = await liveQuestion(mcq('Judge MCQ two'));
    // Echo passes the sample + first hidden test (weight 1 + 2 of 4).
    q.code = await liveQuestion({
      type: 'coding',
      title: 'Judge echo',
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

  beforeEach(() => {
    runner.mode = 'ok';
    runner.calls = [];
    queue.jobs.length = 0;
  });

  it('run: queued (202), polled to a result with sample tests only; per-language limits applied', async () => {
    const examId = await exam();
    const a = await attempt(examId);
    const url = `/api/v1/exam-sessions/${a.id}/runs`;

    const created = await as('candidate', http().post(url))
      .send({ itemId: a.code.id, language: 'python', code: 'echo' })
      .expect(202);
    expect(created.body).toMatchObject({ status: 'queued', results: [] });
    expect(runner.calls).toHaveLength(0); // nothing ran inside the request

    const runUrl = `${url}/${created.body.id}`;
    await as('candidate', http().get(runUrl))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('queued'));
    await queue.drain();
    const done = await as('candidate', http().get(runUrl)).expect(200);
    expect(done.body).toMatchObject({
      status: 'completed',
      verdict: 'AC',
      passedCount: 1,
      totalCount: 1,
      results: [
        { verdict: 'AC', input: 'one', expectedOutput: 'one', stdout: 'one\n' },
      ],
    });
    expect(JSON.stringify(done.body)).not.toContain('HIDDEN');
    // Samples only; Python gets 3× the question's time limit.
    expect(runner.calls[0]).toMatchObject({
      inputs: ['one'],
      timeLimitMs: 3000,
      memoryLimitMb: 128,
    });

    // Compile errors come back with the compiler output.
    await coolDown(a.id);
    const ce = await as('candidate', http().post(url))
      .send({ itemId: a.code.id, language: 'cpp', code: 'ce' })
      .expect(202);
    await queue.drain();
    const ceRun = await as(
      'candidate',
      http().get(`${url}/${ce.body.id}`),
    ).expect(200);
    expect(ceRun.body).toMatchObject({
      verdict: 'CE',
      compileOutput: 'error: expected ;',
    });

    // Cooldown, ownership, MCQs.
    await as('candidate', http().post(url))
      .send({ itemId: a.code.id, language: 'python', code: 'echo' })
      .expect(429);
    await as('other', http().get(runUrl)).expect(404);
    await coolDown(a.id);
    await as('candidate', http().post(url))
      .send({ itemId: a.mcqs[0].id, language: 'python', code: 'echo' })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('NOT_CODING_QUESTION'));
  });

  it('run: judge down → retried, then failed with a message; queue down → 503', async () => {
    const a = await attempt(await exam());
    runner.mode = 'throw';
    const created = await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${a.id}/runs`),
    )
      .send({ itemId: a.code.id, language: 'python', code: 'echo' })
      .expect(202);
    await queue.drain();
    expect(runner.calls).toHaveLength(3); // JUDGE_MAX_ATTEMPTS
    const run = await as(
      'candidate',
      http().get(`/api/v1/exam-sessions/${a.id}/runs/${created.body.id}`),
    ).expect(200);
    expect(run.body).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/didn’t respond/),
    });

    await coolDown(a.id);
    queue.failAdd = true;
    await as('candidate', http().post(`/api/v1/exam-sessions/${a.id}/runs`))
      .send({ itemId: a.code.id, language: 'python', code: 'echo' })
      .expect(503)
      .expect(({ body }) => expect(body.code).toBe('JUDGE_UNAVAILABLE'));
    queue.failAdd = false;
  });

  it('grading on submit: marking scheme for MCQs, weighted partial credit for code, all tests run', async () => {
    const a = await attempt(await exam());
    await as('candidate', http().post(`/api/v1/exam-sessions/${a.id}/submit`))
      .send({
        answers: [
          {
            itemId: a.mcqs[0].id,
            response: { optionIds: [option(a.mcqs[0], 'Right')] },
          },
          {
            itemId: a.mcqs[1].id,
            response: { optionIds: [option(a.mcqs[1], 'Wrong')] },
          },
          {
            itemId: a.code.id,
            response: { language: 'java', sources: { java: 'echo' } },
          },
        ],
      })
      .expect(200);

    const pending = await as(
      'candidate',
      http().get(`/api/v1/exam-sessions/${a.id}`),
    ).expect(200);
    expect(pending.body.grading).toMatchObject({
      status: 'pending',
      score: null,
      maxScore: 14,
    });
    expect(queue.jobs.map((j) => j.data)).toEqual([
      { type: 'grade', sessionId: a.id },
    ]);

    await queue.drain();
    // All three tests, Java limits (2× time, +128 MB).
    expect(runner.calls[0]).toMatchObject({
      language: 'java',
      inputs: ['one', 'HIDDEN-two', 'HIDDEN-three'],
      timeLimitMs: 2000,
      memoryLimitMb: 256,
    });

    const graded = await as(
      'candidate',
      http().get(`/api/v1/exam-sessions/${a.id}`),
    ).expect(200);
    // +2 (right) −0.5 (wrong, 25%) + 10 × 3/4 (weights) = 9
    expect(graded.body.grading).toMatchObject({
      status: 'graded',
      score: 9,
      maxScore: 14,
    });
    const byId = new Map(
      graded.body.items.map((i: { id: string }) => [i.id, i]),
    );
    expect(byId.get(a.mcqs[0].id)).toMatchObject({
      result: { outcome: 'correct', score: 2 },
    });
    expect(byId.get(a.mcqs[1].id)).toMatchObject({
      result: { outcome: 'incorrect', score: -0.5 },
    });
    expect(byId.get(a.code.id)).toMatchObject({
      result: { outcome: 'partial', score: 7.5 },
    });
    expect(JSON.stringify(graded.body)).not.toContain('HIDDEN');

    // Staff see hidden-test verdicts; candidates can't reach the report.
    const report = await as(
      'support',
      http().get(`/api/v1/admin/exam-sessions/${a.id}/grading`),
    ).expect(200);
    const code = report.body.items.find(
      (i: { type: string }) => i.type === 'coding',
    );
    expect(code.submission).toMatchObject({
      verdict: 'WA',
      passedCount: 2,
      totalCount: 3,
      passedWeight: 3,
      totalWeight: 4,
    });
    expect(
      code.submission.results.map(
        (r: { verdict: string; isSample: boolean }) => [r.verdict, r.isSample],
      ),
    ).toEqual([
      ['AC', true],
      ['AC', false],
      ['WA', false],
    ]);
    await as(
      'candidate',
      http().get(`/api/v1/admin/exam-sessions/${a.id}/grading`),
    ).expect(403);

    // A duplicate job is a no-op.
    await queue.add(
      'grade',
      { type: 'grade', sessionId: a.id },
      { attempts: 1 },
    );
    await queue.drain();
    expect(runner.calls).toHaveLength(1);
  });

  it('grading without partial credit, unanswered and non-compiling code', async () => {
    const strict = await attempt(await exam({ partialScoring: false }));
    await as(
      'candidate',
      http().post(`/api/v1/exam-sessions/${strict.id}/submit`),
    )
      .send({
        answers: [
          {
            itemId: strict.code.id,
            response: { language: 'python', sources: { python: 'echo' } },
          },
        ],
      })
      .expect(200);
    const ce = await attempt(await exam(), 'other');
    await as('other', http().post(`/api/v1/exam-sessions/${ce.id}/submit`))
      .send({
        answers: [
          {
            itemId: ce.code.id,
            response: { language: 'cpp', sources: { cpp: 'ce' } },
          },
        ],
      })
      .expect(200);
    await queue.drain();

    const s1 = await prisma.examSession.findUniqueOrThrow({
      where: { id: strict.id },
      include: { items: true },
    });
    expect(s1).toMatchObject({ gradingStatus: 'graded', scoreCenti: 0 });
    expect(s1.items.map((i) => i.outcome).sort()).toEqual([
      'incorrect',
      'unanswered',
      'unanswered',
    ]);
    const s2 = await prisma.examSession.findUniqueOrThrow({
      where: { id: ce.id },
      include: { items: true },
    });
    expect(s2.items.find((i) => i.type === 'coding')).toMatchObject({
      outcome: 'incorrect',
      scoreCenti: 0,
    });
  });

  it('judge outage: retried, then failed with MCQs still scored; admins regrade once it’s back', async () => {
    const a = await attempt(await exam());
    runner.mode = 'throw';
    await as('candidate', http().post(`/api/v1/exam-sessions/${a.id}/submit`))
      .send({
        answers: [
          {
            itemId: a.mcqs[0].id,
            response: { optionIds: [option(a.mcqs[0], 'Right')] },
          },
          {
            itemId: a.code.id,
            response: { language: 'python', sources: { python: 'echo' } },
          },
        ],
      })
      .expect(200);
    await queue.drain();
    expect(runner.calls).toHaveLength(3);
    let s = await prisma.examSession.findUniqueOrThrow({
      where: { id: a.id },
      include: { items: true },
    });
    expect(s).toMatchObject({
      gradingStatus: 'failed',
      gradingError: expect.stringMatching(/503/),
    });
    expect(s.items.find((i) => i.id === a.mcqs[0].id)).toMatchObject({
      outcome: 'correct',
      scoreCenti: 200,
    });

    await as(
      'support',
      http().post(`/api/v1/admin/exam-sessions/${a.id}/regrade`),
    ).expect(403);
    runner.mode = 'ok';
    const regrade = await as(
      'admin',
      http().post(`/api/v1/admin/exam-sessions/${a.id}/regrade`),
    ).expect(202);
    expect(regrade.body.grading.status).toBe('pending');
    await queue.drain();
    s = await prisma.examSession.findUniqueOrThrow({
      where: { id: a.id },
      include: { items: true },
    });
    // +2 + 7.5
    expect(s).toMatchObject({
      gradingStatus: 'graded',
      scoreCenti: 950,
      gradingError: null,
    });
  });

  it('no judge configured: coding can’t be graded (reported), and time-outs are graded too', async () => {
    runner.mode = 'unavailable';
    const examId = await exam();
    const a = await attempt(examId);
    await as('candidate', http().patch(`/api/v1/exam-sessions/${a.id}`))
      .send({
        answers: [
          {
            itemId: a.code.id,
            response: { language: 'python', sources: { python: 'echo' } },
          },
        ],
      })
      .expect(200);
    // The clock runs out while the candidate is away; the sweep submits and grading follows.
    await prisma.examSession.update({
      where: { id: a.id },
      data: { lastSyncedAt: new Date(Date.now() - 31 * MIN) },
    });
    await sessions.sweep();
    expect(queue.jobs.map((j) => j.data)).toEqual([
      { type: 'grade', sessionId: a.id },
    ]);
    await queue.drain();
    const s = await prisma.examSession.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(s).toMatchObject({
      status: 'submitted',
      submitReason: 'time_expired',
      gradingStatus: 'failed',
      gradingError: expect.stringMatching(/isn’t available/),
    });
    // Only one call: the judge being unavailable isn't retried.
    expect(runner.calls).toHaveLength(1);
  });

  it('a retry takes over an attempt its own failed try left in `grading`; a fresh duplicate does not', async () => {
    const a = await attempt(await exam());
    await as('candidate', http().post(`/api/v1/exam-sessions/${a.id}/submit`))
      .send({
        answers: [
          {
            itemId: a.code.id,
            response: { language: 'python', sources: { python: 'echo' } },
          },
        ],
      })
      .expect(200);
    queue.jobs.length = 0;
    // Simulate a first try that crashed after claiming, before it could reset the status.
    await prisma.examSession.update({
      where: { id: a.id },
      data: { gradingStatus: 'grading' },
    });
    const job = (attemptsMade: number) => ({
      data: { type: 'grade' as const, sessionId: a.id },
      attemptsMade,
      opts: { attempts: 3 },
    });

    await judge.process(job(0));
    expect(runner.calls).toHaveLength(0);
    await judge.process(job(1));
    expect(runner.calls).toHaveLength(1);
    const s = await prisma.examSession.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(s).toMatchObject({ gradingStatus: 'graded', scoreCenti: 750 });
  });
});
