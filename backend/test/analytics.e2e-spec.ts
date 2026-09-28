/**
 * Insights & analytics (FRD §4.9) against a real Postgres: platform KPIs and
 * daily series, the question-stats background job and its flags, candidate
 * insights (topics, difficulty, trend, recommendations), the live admin and
 * candidate dashboard widgets, and CSV export (incl. formula neutralising).
 * Runs only with E2E_DATABASE_URL.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import type { AnalyticsJob } from '../src/modules/analytics/models/analytics.model.js';
import type { JudgeJob } from '../src/modules/judge/models/judge.model.js';
import { BOM } from '../src/modules/analytics/models/csv.js';
import { fakeConfig } from './utils/fake-config.js';
import type { FakeQueue } from './utils/fake-mail.js';
import { createTestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-analytics.test';
const PREFIX = 'e2eanalytics';
const CANDIDATES = ['c1', 'c2', 'c3', 'c4', 'c5'];

describe.skipIf(!DB_URL)('Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let judgeQueue: FakeQueue<JudgeJob>;
  let analyticsQueue: FakeQueue<AnalyticsJob>;
  const token: Record<string, string> = {};
  const q: Record<string, string> = {};
  const topic: Record<string, string> = {};
  let mixExam: string;
  let betaExam: string;

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

  const mcq = async (title: string, topicId: string, difficulty = 'easy') => {
    const created = await as('editor', http().post('/api/v1/admin/questions'))
      .send({
        type: 'mcq',
        title,
        body: 'Pick one.',
        topicId,
        difficulty,
        tagIds: [],
        mcq: {
          allowMultiple: false,
          options: [
            { text: 'Right', isCorrect: true },
            { text: 'Wrong', isCorrect: false },
          ],
        },
      })
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

  const exam = async (title: string, questionIds: string[]) => {
    const res = await as('admin', http().post('/api/v1/admin/exams'))
      .send({
        title: `${PREFIX} ${title}`,
        instructions: 'Go.',
        durationMinutes: 30,
        sections: [{ title: 'All', questionIds }],
      })
      .expect(201);
    await as(
      'admin',
      http().post(`/api/v1/admin/exams/${res.body.id}/publish`),
    ).expect(200);
    return res.body.id as string;
  };

  /** Alpha questions answered right, Beta ones wrong; submitted and graded. */
  const take = async (examId: string, who: string) => {
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
    const answers = (
      s.body.items as {
        id: string;
        question: {
          title: string;
          mcq: { options: { id: string; text: string }[] };
        };
      }[]
    ).map((i) => ({
      itemId: i.id,
      response: {
        optionIds: [
          i.question.mcq.options.find(
            (o) =>
              o.text ===
              (i.question.title.includes('Alpha') ? 'Right' : 'Wrong'),
          )!.id,
        ],
      },
    }));
    await as(who, http().post(`/api/v1/exam-sessions/${id}/submit`))
      .send({ answers })
      .expect(200);
    await judgeQueue.drain();
    return id;
  };

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();
    const t = await createTestApp({ prisma });
    app = t.app;
    judgeQueue = t.judgeQueue;
    analyticsQueue = t.analyticsQueue;

    const roles: [string, UserRole][] = [
      ...CANDIDATES.map((c): [string, UserRole] => [c, 'candidate']),
      ['fresh', 'candidate'],
      ['support', 'support'],
      ['editor', 'editor'],
      ['admin', 'admin'],
    ];
    for (const [who, role] of roles) {
      const email = `${who}${DOMAIN}`;
      await prisma.user.create({
        data: {
          name: `Analytics ${who}`,
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
    for (const name of ['Alpha', 'Beta']) {
      const res = await as('editor', http().post('/api/v1/admin/topics'))
        .send({ name: `E2E ${name}`, slug: `${PREFIX}-${name.toLowerCase()}` })
        .expect(201);
      topic[name] = res.body.id;
    }
    for (const n of [1, 2, 3]) {
      q[`a${n}`] = await mcq(`Alpha ${n}`, topic.Alpha);
      q[`b${n}`] = await mcq(`Beta ${n}`, topic.Beta, 'hard');
    }
    // Never answered by anyone; the title tries to smuggle a spreadsheet formula into CSVs.
    q.unused = await mcq(
      '=HYPERLINK("http://evil.test","Beta 4")',
      topic.Beta,
      'hard',
    );

    mixExam = await exam('Mix', [q.a1, q.a2, q.a3, q.b1, q.b2, q.b3]);
    betaExam = await exam('Beta practice', [q.unused]);
    for (const c of CANDIDATES) await take(mixExam, c);
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('question stats: rebuilt by the background job, with quality flags, filters and CSV', async () => {
    await as('support', http().get('/api/v1/admin/analytics/questions')).expect(
      403,
    );
    await as(
      'c1',
      http().post('/api/v1/admin/analytics/questions/refresh'),
    ).expect(403);

    const queued = await as(
      'editor',
      http().post('/api/v1/admin/analytics/questions/refresh'),
    ).expect(202);
    expect(queued.body.queued).toBe(true);
    expect(analyticsQueue.jobs).toHaveLength(1);
    await analyticsQueue.drain();

    const { body } = await as(
      'editor',
      http().get(
        `/api/v1/admin/analytics/questions?search=Alpha&sort=title&dir=asc`,
      ),
    ).expect(200);
    expect(body.computedAt).not.toBeNull();
    expect(body.rows.map((r: { title: string }) => r.title)).toEqual([
      'Alpha 1',
      'Alpha 2',
      'Alpha 3',
    ]);
    expect(body.rows[0]).toMatchObject({
      attempts: 5,
      answered: 5,
      correct: 5,
      accuracy: 100,
      avgScore: 100,
      flags: ['too_easy'],
    });

    const hard = await as(
      'admin',
      http().get(
        `/api/v1/admin/analytics/questions?topicId=${topic.Beta}&flag=too_hard`,
      ),
    ).expect(200);
    expect(
      hard.body.rows.map((r: { title: string }) => r.title).sort(),
    ).toEqual(['Beta 1', 'Beta 2', 'Beta 3']);
    expect(hard.body.rows[0]).toMatchObject({ accuracy: 0, incorrect: 5 });

    const unused = await as(
      'admin',
      http().get(
        `/api/v1/admin/analytics/questions?topicId=${topic.Beta}&flag=unused`,
      ),
    ).expect(200);
    expect(unused.body.rows).toEqual([
      expect.objectContaining({
        questionId: q.unused,
        attempts: 0,
        accuracy: null,
      }),
    ]);

    // Hardest first; questions with no data yet sort last in either direction.
    for (const dir of ['asc', 'desc']) {
      const sorted = await as(
        'admin',
        http().get(
          `/api/v1/admin/analytics/questions?topicId=${topic.Beta}&sort=accuracy&dir=${dir}`,
        ),
      ).expect(200);
      expect(sorted.body.rows.at(-1).questionId).toBe(q.unused);
    }

    // Rebuilding is idempotent.
    await as(
      'admin',
      http().post('/api/v1/admin/analytics/questions/refresh'),
    ).expect(202);
    await analyticsQueue.drain();
    expect(
      await prisma.questionStat.count({
        where: { questionId: { in: [q.a1, q.b1] } },
      }),
    ).toBe(2);

    const csv = await as(
      'editor',
      http().get(
        `/api/v1/admin/analytics/questions?topicId=${topic.Beta}&format=csv`,
      ),
    ).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="question-stats-/,
    );
    const lines = csv.text.replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'question_id,title,type,difficulty,topic,attempts,answered,correct,partial,incorrect,accuracy_percent,avg_score_percent,avg_time_seconds,flags',
    );
    expect(lines).toHaveLength(5);
    // The formula is neutralised with a leading apostrophe (and quoted).
    const evil = lines.find((l) => l.includes('HYPERLINK'))!;
    expect(evil).toContain(`"'=HYPERLINK(""http://evil.test"",""Beta 4"")"`);
  });

  it('candidate insights: topics strongest first with labels, difficulty, trend, recommendations, CSV', async () => {
    const { body } = await as('c1', http().get('/api/v1/insights')).expect(200);
    expect(body.totals).toMatchObject({
      testsCompleted: 1,
      questionsAnswered: 6,
      averagePercent: 50,
      bestPercent: 50,
    });
    expect(
      body.topics.map(
        (t: { name: string; mastery: number; strength: string }) => [
          t.name,
          t.mastery,
          t.strength,
        ],
      ),
    ).toEqual([
      ['E2E Alpha', 100, 'strong'],
      ['E2E Beta', 0, 'weak'],
    ]);
    expect(body.difficulty).toEqual([
      expect.objectContaining({
        difficulty: 'easy',
        questions: 3,
        mastery: 100,
      }),
      expect.objectContaining({ difficulty: 'medium', questions: 0 }),
      expect.objectContaining({ difficulty: 'hard', questions: 3, mastery: 0 }),
    ]);
    expect(body.trend).toEqual([
      expect.objectContaining({ examId: mixExam, percent: 50 }),
    ]);
    // The untaken Beta test is aimed at the weak topic, so it comes first.
    expect(body.recommendations[0]).toMatchObject({
      examId: betaExam,
      weakTopics: ['E2E Beta'],
    });
    expect(
      body.recommendations.map((r: { examId: string }) => r.examId),
    ).not.toContain(mixExam);

    const csv = await as(
      'c1',
      http().get('/api/v1/insights?format=csv'),
    ).expect(200);
    const lines = csv.text.replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'topic,strength,mastery_percent,accuracy_percent,questions,answered,correct,avg_time_seconds',
    );
    expect(lines[1]).toMatch(/^E2E Alpha,strong,100,100,3,3,3,/);

    // No history yet: empty insights, newest tests recommended.
    const fresh = await as('fresh', http().get('/api/v1/insights')).expect(200);
    expect(fresh.body).toMatchObject({
      totals: { testsCompleted: 0, averagePercent: null },
      topics: [],
      trend: [],
    });
    expect(fresh.body.recommendations.length).toBeGreaterThan(0);
  });

  it('dashboards: candidate recommendations and admin KPIs are live', async () => {
    const dash = await as('c1', http().get('/api/v1/dashboard')).expect(200);
    expect(dash.body.recommendedTests.status).toBe('live');
    expect(dash.body.recommendedTests.data[0]).toMatchObject({
      id: betaExam,
      topic: 'Practises E2E Beta',
      difficulty: 'hard',
    });

    const admin = await as(
      'support',
      http().get('/api/v1/admin/dashboard'),
    ).expect(200);
    expect(admin.body.engagement.status).toBe('live');
    // Every candidate here logged in today.
    expect(admin.body.engagement.data.dau).toBeGreaterThanOrEqual(
      CANDIDATES.length + 1,
    );
    expect(admin.body.engagement.data.mau).toBeGreaterThanOrEqual(
      admin.body.engagement.data.dau,
    );
    expect(admin.body.testVolume).toMatchObject({ status: 'live' });
    expect(admin.body.testVolume.data.attempts7d).toBeGreaterThanOrEqual(
      CANDIDATES.length,
    );
    expect(admin.body.subscriptions.status).toBe('coming_soon');
  });

  it('platform overview: daily series with CSV; admin and support only', async () => {
    await as('editor', http().get('/api/v1/admin/analytics/overview')).expect(
      403,
    );
    await as('c1', http().get('/api/v1/admin/analytics/overview')).expect(403);

    const { body } = await as(
      'admin',
      http().get('/api/v1/admin/analytics/overview?days=14'),
    ).expect(200);
    expect(body.daily).toHaveLength(14);
    const today = body.daily[13];
    expect(today.day).toBe(new Date().toISOString().slice(0, 10));
    expect(today.signups).toBeGreaterThanOrEqual(CANDIDATES.length + 1);
    expect(today.activeUsers).toBeGreaterThanOrEqual(CANDIDATES.length + 1);
    expect(today.attemptsSubmitted).toBeGreaterThanOrEqual(CANDIDATES.length);
    expect(body.kpis.graded30d).toBeGreaterThanOrEqual(CANDIDATES.length);

    const csv = await as(
      'support',
      http().get('/api/v1/admin/analytics/overview?days=7&format=csv'),
    ).expect(200);
    const lines = csv.text.replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'day_utc,signups,active_users,attempts_started,attempts_submitted,avg_percent',
    );
    expect(lines).toHaveLength(8);
  });
});
