/**
 * Question bank (FRD §4.11) against a real Postgres: editor/admin workflow,
 * versioning, taxonomy and bulk import. Runs only with E2E_DATABASE_URL.
 */
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { UserRole } from '../src/generated/prisma/enums.js';
import { fakeConfig } from './utils/fake-config.js';
import { createTestApp } from './utils/test-app.js';

const DB_URL = process.env.E2E_DATABASE_URL;
const DOMAIN = '@e2e-qb.test';
const PREFIX = 'e2eqb';

describe.skipIf(!DB_URL)('Question bank (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  let topicId: string;
  let tagId: string;

  const http = () => request(app.getHttpServer());
  const as = (who: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token[who]}`);

  const cleanup = async () => {
    await prisma.questionImport.deleteMany({
      where: { fileName: { startsWith: PREFIX } },
    });
    await prisma.question.deleteMany({
      where: {
        OR: [
          { externalId: { startsWith: PREFIX } },
          { topic: { slug: { startsWith: PREFIX } } },
        ],
      },
    });
    await prisma.topic.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.tag.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  };

  const mcqInput = (overrides: Record<string, unknown> = {}) => ({
    type: 'mcq',
    title: 'Which planet is largest?',
    body: 'Pick one.',
    topicId,
    difficulty: 'easy',
    tagIds: [tagId],
    mcq: {
      allowMultiple: false,
      options: [
        { text: 'Jupiter', isCorrect: true },
        { text: 'Mars', isCorrect: false },
      ],
    },
    ...overrides,
  });

  beforeAll(async () => {
    prisma = new PrismaService(fakeConfig({ DATABASE_URL: DB_URL }));
    await cleanup();
    ({ app } = await createTestApp({ prisma }));

    const roles: UserRole[] = ['candidate', 'support', 'editor', 'admin'];
    for (const role of roles) {
      const email = `${role}${DOMAIN}`;
      await prisma.user.create({
        data: {
          name: `QB ${role}`,
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
      token[role] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await app?.close();
  });

  it('taxonomy: editors manage topics & tags; slugs are unique; used topics are protected', async () => {
    await as('candidate', http().get('/api/v1/admin/topics')).expect(403);
    await as('support', http().post('/api/v1/admin/topics'))
      .send({ name: 'Nope' })
      .expect(403);

    const topic = await as('editor', http().post('/api/v1/admin/topics'))
      .send({ name: 'E2E QB Astronomy', slug: `${PREFIX}-astronomy` })
      .expect(201);
    topicId = topic.body.id;
    await as('editor', http().post('/api/v1/admin/topics'))
      .send({ name: 'Dup', slug: `${PREFIX}-astronomy` })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('SLUG_TAKEN'));

    const tag = await as('editor', http().post('/api/v1/admin/tags'))
      .send({ name: 'E2E QB Planets', slug: `${PREFIX}-planets` })
      .expect(201);
    tagId = tag.body.id;
    expect(tag.body.kind).toBe('skill');

    const list = await as('support', http().get('/api/v1/admin/topics')).expect(
      200,
    );
    expect(
      list.body.find((t: { id: string }) => t.id === topicId),
    ).toMatchObject({ questionCount: 0 });
  });

  it('validates questions (shape + cross-field rules)', async () => {
    await as('editor', http().post('/api/v1/admin/questions'))
      .send(
        mcqInput({
          mcq: {
            allowMultiple: false,
            options: [
              { text: 'A', isCorrect: false },
              { text: 'B', isCorrect: false },
            ],
          },
        }),
      )
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_QUESTION');
        expect(body.errors[0]).toMatchObject({ field: 'mcq.options' });
      });
    await as('editor', http().post('/api/v1/admin/questions'))
      .send(mcqInput({ title: 'x' }))
      .expect(400);
    await as('editor', http().post('/api/v1/admin/questions'))
      .send({
        ...mcqInput(),
        type: 'coding',
        mcq: undefined,
        coding: {
          testCases: [{ input: '1', expectedOutput: '1', isSample: true }],
        },
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body.message).toBe('Add at least one hidden test case'),
      );
  });

  it('versions every edit, keeps option ids, and skips no-op saves', async () => {
    const created = await as('editor', http().post('/api/v1/admin/questions'))
      .send(mcqInput())
      .expect(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({
      status: 'draft',
      currentVersion: 1,
      liveVersion: null,
    });
    const [jupiter] = created.body.version.content.mcq.options;

    const edited = await as(
      'editor',
      http().put(`/api/v1/admin/questions/${id}`),
    )
      .send(
        mcqInput({
          title: 'Which planet is the largest?',
          changeNote: 'Wording',
        }),
      )
      .expect(200);
    expect(edited.body.changed).toBe(true);
    expect(edited.body.question.currentVersion).toBe(2);
    // Options sent without ids keep their previous ids (answer keys stay valid).
    expect(edited.body.question.version.content.mcq.options[0].id).toBe(
      jupiter.id,
    );

    const same = await as('editor', http().put(`/api/v1/admin/questions/${id}`))
      .send(mcqInput({ title: 'Which planet is the largest?' }))
      .expect(200);
    expect(same.body).toMatchObject({
      changed: false,
      question: { currentVersion: 2 },
    });

    const v1 = await as(
      'editor',
      http().get(`/api/v1/admin/questions/${id}/versions/1`),
    ).expect(200);
    expect(v1.body.title).toBe('Which planet is largest?');
    expect(
      same.body.question.history.map(
        (h: { versionNumber: number }) => h.versionNumber,
      ),
    ).toEqual([2, 1]);

    await as('editor', http().put(`/api/v1/admin/questions/${id}`))
      .send({ ...mcqInput(), type: 'coding' })
      .expect(400);
  });

  it('draft → review → reject → fix → approve → live; edits keep the live version', async () => {
    const { body: q } = await as(
      'editor',
      http().post('/api/v1/admin/questions'),
    )
      .send(mcqInput({ title: 'Workflow question' }))
      .expect(201);
    const url = `/api/v1/admin/questions/${q.id}`;

    await as('editor', http().post(`${url}/approve`)).expect(403); // editors can't approve
    await as('admin', http().post(`${url}/approve`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INVALID_TRANSITION'));

    await as('editor', http().post(`${url}/submit`))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: 'pending_review',
          submittedBy: { name: 'QB editor' },
        }),
      );
    await as('admin', http().post(`${url}/reject`))
      .send({ note: '' })
      .expect(400);
    await as('admin', http().post(`${url}/reject`))
      .send({ note: 'Add an explanation' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: 'rejected',
          reviewNote: 'Add an explanation',
        }),
      );

    await as('editor', http().put(url))
      .send(
        mcqInput({
          title: 'Workflow question',
          explanation: 'Jupiter is the largest.',
        }),
      )
      .expect(200);
    await as('editor', http().post(`${url}/submit`)).expect(200);
    const approved = await as('admin', http().post(`${url}/approve`)).expect(
      200,
    );
    expect(approved.body).toMatchObject({
      status: 'published',
      currentVersion: 2,
      liveVersion: 2,
      reviewedBy: { name: 'QB admin' },
    });

    // Editing a published question: new draft version, old one stays live.
    const edited = await as('editor', http().put(url))
      .send(mcqInput({ title: 'Workflow question v3', explanation: 'x' }))
      .expect(200);
    expect(edited.body.question).toMatchObject({
      status: 'draft',
      currentVersion: 3,
      liveVersion: 2,
    });
    expect(
      edited.body.question.history.find((h: { isLive: boolean }) => h.isLive)
        .versionNumber,
    ).toBe(2);

    await as('editor', http().post(`${url}/archive`)).expect(403);
    await as('admin', http().post(`${url}/archive`))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'archived', liveVersion: null }),
      );
    await as('editor', http().put(url))
      .send(mcqInput())
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('QUESTION_ARCHIVED'));
    await as('admin', http().post(`${url}/restore`))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('draft'));
  });

  it('lists with filters and status counts', async () => {
    const { body } = await as('admin', http().get('/api/v1/admin/questions'))
      .query({ topicId, tagId, type: 'mcq' })
      .expect(200);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(
      body.items.every(
        (q: { topic: { id: string } }) => q.topic.id === topicId,
      ),
    ).toBe(true);
    expect(body.items[0].tags[0]).toMatchObject({ slug: `${PREFIX}-planets` });
    expect(body.statusCounts).toHaveProperty('draft');
    await as('support', http().get('/api/v1/admin/questions')).expect(403);
  });

  it('protects topics in use; deleting a tag detaches it', async () => {
    await as('editor', http().delete(`/api/v1/admin/topics/${topicId}`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TOPIC_IN_USE'));
    await as('editor', http().delete(`/api/v1/admin/tags/${tagId}`)).expect(
      204,
    );
    const { body } = await as('admin', http().get('/api/v1/admin/questions'))
      .query({ topicId })
      .expect(200);
    expect(
      body.items.every((q: { tags: unknown[] }) => q.tags.length === 0),
    ).toBe(true);
  });

  describe('bulk import', () => {
    const upload = (
      file: string,
      name: string,
      query: Record<string, string> = {},
    ) =>
      as('editor', http().post('/api/v1/admin/question-imports'))
        .query(query)
        .attach('file', Buffer.from(file), name);

    const json = (questions: unknown[]) => JSON.stringify({ questions });
    const row = (
      externalId: string,
      title: string,
      extra: Record<string, unknown> = {},
    ) => ({
      externalId,
      type: 'mcq',
      title,
      body: 'Body',
      topic: `${PREFIX}-astronomy`,
      difficulty: 'medium',
      mcq: {
        options: [
          { text: 'Yes', isCorrect: true },
          { text: 'No', isCorrect: false },
        ],
      },
      ...extra,
    });

    it('dry run validates every row and writes nothing', async () => {
      const file = json([
        row(`${PREFIX}-1`, 'Imported question one'),
        row(`${PREFIX}-2`, 'Bad', {
          difficulty: 'impossible',
          topic: 'no-such-topic',
        }),
        row(`${PREFIX}-1`, 'Duplicate id'),
      ]);
      const { body } = await upload(file, `${PREFIX}-dry.json`, {
        dryRun: 'true',
      }).expect(201);
      expect(body).toMatchObject({
        dryRun: true,
        importId: null,
        totalRows: 3,
        created: 1,
        failed: 2,
      });
      expect(
        body.rows[1].errors.map((e: { field: string }) => e.field),
      ).toEqual(expect.arrayContaining(['topic']));
      expect(body.rows[2].errors[0].message).toBe(
        'duplicate of row 1 in this file',
      );
      expect(
        await prisma.question.count({ where: { externalId: `${PREFIX}-1` } }),
      ).toBe(0);
    });

    it('imports valid rows, reports the rest, and re-imports idempotently by externalId', async () => {
      const csv = [
        'external_id,type,title,body,topic,difficulty,tags,option_1,option_2,correct',
        `${PREFIX}-csv-1,mcq,CSV question,"Body, with comma",${PREFIX}-astronomy,easy,,Yes,No,1`,
        `${PREFIX}-csv-2,mcq,Missing correct,Body,${PREFIX}-astronomy,easy,,Yes,No,`,
      ].join('\n');
      const first = await upload(csv, `${PREFIX}-a.csv`).expect(201);
      expect(first.body).toMatchObject({
        created: 1,
        failed: 1,
        dryRun: false,
      });
      expect(first.body.importId).toBeTruthy();
      expect(first.body.rows[1].errors[0].field).toBe('correct');

      const again = await upload(csv, `${PREFIX}-b.csv`).expect(201);
      expect(again.body).toMatchObject({ created: 0, unchanged: 1 });

      const changed = await upload(
        csv.replace('CSV question', 'CSV question (edited)'),
        `${PREFIX}-c.csv`,
        {
          submitForReview: 'true',
        },
      ).expect(201);
      expect(changed.body.updated).toBe(1);
      const q = await prisma.question.findUnique({
        where: { externalId: `${PREFIX}-csv-1` },
        include: { currentVersion: true },
      });
      expect(q).toMatchObject({
        status: 'pending_review',
        title: 'CSV question (edited)',
      });
      expect(q!.currentVersion!.versionNumber).toBe(2);

      const history = await as(
        'admin',
        http().get('/api/v1/admin/question-imports'),
      ).expect(200);
      const mine = history.body.filter((h: { fileName: string }) =>
        h.fileName.startsWith(PREFIX),
      );
      expect(mine[mine.length - 1]).toMatchObject({
        createdCount: 1,
        errorCount: 1,
        uploadedBy: { name: 'QB editor' },
      });
    });

    it('can create missing topics and company tags', async () => {
      const file = json([
        row(`${PREFIX}-new-tax`, 'Needs new taxonomy', {
          topic: `${PREFIX} Galaxies`,
          tags: [`company:${PREFIX} Corp`],
        }),
      ]);
      await upload(file, `${PREFIX}-tax.json`)
        .expect(201)
        .expect(({ body }) =>
          expect(body.rows[0].errors[0].field).toBe('topic'),
        );
      const dry = await upload(file, `${PREFIX}-tax.json`, {
        dryRun: 'true',
        createMissingTaxonomy: 'true',
      }).expect(201);
      expect(dry.body).toMatchObject({ created: 1, failed: 0 });
      expect(
        await prisma.topic.count({ where: { slug: `${PREFIX}-galaxies` } }),
      ).toBe(0);

      const real = await upload(file, `${PREFIX}-tax.json`, {
        createMissingTaxonomy: 'true',
      }).expect(201);
      expect(real.body.created).toBe(1);
      expect(
        await prisma.tag.findUnique({ where: { slug: `${PREFIX}-corp` } }),
      ).toMatchObject({ kind: 'company' });
    });

    it('rejects unusable files and serves templates', async () => {
      await upload('{broken', `${PREFIX}.json`)
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_IMPORT_FILE'));
      await upload('hello', `${PREFIX}.txt`)
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('UNSUPPORTED_FILE_TYPE'));
      await as(
        'candidate',
        http().post('/api/v1/admin/question-imports'),
      ).expect(403);

      const csvTemplate = await as(
        'editor',
        http().get('/api/v1/admin/question-imports/template'),
      ).expect(200);
      expect(csvTemplate.headers['content-disposition']).toContain(
        'question-import-template.csv',
      );
      expect(csvTemplate.text.split('\r\n')[0]).toContain(
        'external_id,type,title',
      );
      const jsonTemplate = await as(
        'editor',
        http().get('/api/v1/admin/question-imports/template?format=json'),
      ).expect(200);
      expect(JSON.parse(jsonTemplate.text).questions).toHaveLength(2);
    });
  });
});
