/**
 * Seeds development data: topics, tags and published sample questions
 * from db/seed/questions.sample.json (itself a valid bulk-import file).
 * Idempotent — re-running updates by slug / externalId.
 *
 *   npm run build && npm run seed:dev
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { PrismaService } from '../database/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import type { TagKind } from '../generated/prisma/enums.js';
import { QuestionImportService } from '../modules/question-bank/services/question-import.service.js';
import { QuestionService } from '../modules/question-bank/services/question.service.js';
import type { ExamInputDto } from '../modules/exams/models/exam-input.dto.js';
import { ExamAdminService } from '../modules/exams/services/exam-admin.service.js';

interface SeedFile {
  topics: {
    slug: string;
    name: string;
    description?: string;
    sortOrder?: number;
  }[];
  tags: { slug: string; name: string; kind?: TagKind }[];
}

const SEED_FILE = process.env.SEED_FILE ?? '../db/seed/questions.sample.json';

async function main() {
  try {
    for (const [k, v] of Object.entries(
      parseEnv(readFileSync('.env', 'utf8')),
    )) {
      process.env[k] ??= v;
    }
  } catch {
    // no .env — use the real environment
  }
  if (
    process.env.NODE_ENV === 'production' &&
    !process.argv.includes('--force')
  ) {
    throw new Error(
      'Refusing to seed a production database (pass --force if you really mean it).',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const buffer = readFileSync(SEED_FILE);
    const seed = JSON.parse(buffer.toString('utf8')) as SeedFile;

    for (const t of seed.topics) {
      await prisma.topic.upsert({
        where: { slug: t.slug },
        create: t,
        update: {
          name: t.name,
          description: t.description,
          sortOrder: t.sortOrder,
          deletedAt: null,
        },
      });
    }
    for (const t of seed.tags) {
      await prisma.tag.upsert({
        where: { slug: t.slug },
        create: { ...t, kind: t.kind ?? 'skill' },
        update: { name: t.name, kind: t.kind ?? 'skill', deletedAt: null },
      });
    }

    const db = prisma as unknown as PrismaService;
    const questions = new QuestionService(db);
    const report = await new QuestionImportService(db, questions).import(
      null,
      { buffer, originalname: 'questions.sample.json' },
      { dryRun: false, submitForReview: false, createMissingTaxonomy: false },
    );
    if (report.failed) {
      console.error(
        JSON.stringify(
          report.rows.filter((r) => r.errors.length),
          null,
          2,
        ),
      );
      throw new Error(`${report.failed} seed question(s) failed validation`);
    }

    // Publish everything so the seed data is usable by candidates straight away.
    let published = 0;
    for (const row of report.rows) {
      const q = await questions.get(row.questionId!);
      if (q.status === 'published' && q.liveVersion === q.currentVersion)
        continue;
      if (q.status !== 'pending_review')
        await questions.transition(null, q.id, 'submit');
      await questions.transition(null, q.id, 'approve');
      published++;
    }

    const exams = await seedExams(db);

    const total = await prisma.question.count({
      where: { deletedAt: null, externalId: { startsWith: 'seed-' } },
    });
    console.log(
      `Seeded ${seed.topics.length} topics, ${seed.tags.length} tags and ${report.totalRows} questions ` +
        `(${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged, ${published} published now). ` +
        `Sample questions in DB: ${total}. Sample exams: ${exams}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** Sample exams (FRD §4.6) built from the seed questions. Skipped if one with the same title exists. */
async function seedExams(db: PrismaService): Promise<string> {
  const ids = async (externalIds: string[]) => {
    const rows = await db.question.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(rows.map((r) => [r.externalId, r.id]));
    return externalIds.map((e) => byExt.get(e)!);
  };
  const mcqs = (...n: number[]) => ids(n.map((i) => `seed-mcq-00${i}`));
  const codes = (...n: number[]) => ids(n.map((i) => `seed-code-00${i}`));

  const exams: ExamInputDto[] = [
    {
      title: 'Software Engineering Fundamentals — Mock Test',
      kind: 'mock_exam',
      description:
        'Eight core CS questions and two coding problems. Move freely between questions.',
      instructions: [
        '- You have **45 minutes** for the whole test.',
        '- Section 1 has multiple-choice questions. A wrong answer costs **25%** of that question’s marks; unanswered questions cost nothing.',
        '- Section 2 has two coding problems worth 10 marks each. Use **Run** to try your code on the sample cases.',
        '- Your answers are saved automatically. If you lose your connection, reopen the test to carry on where you left off.',
        '- The test is submitted automatically when time runs out.',
      ].join('\n'),
      durationMinutes: 45,
      sectionTimed: false,
      pauseOnDisconnect: true,
      shuffleQuestions: false,
      shuffleOptions: true,
      maxAttempts: null,
      passPercent: 60,
      sections: [
        {
          title: 'Core CS',
          description:
            'Data structures, databases, operating systems and networks.',
          negativeMarkPercent: 25,
          partialScoring: false,
          questionIds: await mcqs(1, 2, 3, 4, 5, 6, 7, 8),
        },
        {
          title: 'Coding',
          marksPerQuestion: 10,
          negativeMarkPercent: 0,
          partialScoring: true,
          questionIds: await codes(1, 2),
        },
      ],
    },
    {
      title: 'Backend Engineer — Virtual Interview',
      kind: 'virtual_interview',
      description:
        'A timed two-round interview: a quick warm-up, then problem solving.',
      instructions: [
        '- This interview has **two timed rounds**. Each round has its own clock.',
        '- When you finish a round (or its time runs out) it closes and you can’t go back to it.',
        '- The clock keeps running if you disconnect, so make sure your connection is stable.',
        '- Your answers are saved automatically.',
      ].join('\n'),
      durationMinutes: 35,
      sectionTimed: true,
      pauseOnDisconnect: false,
      shuffleQuestions: true,
      shuffleOptions: false,
      maxAttempts: 3,
      passPercent: null,
      sections: [
        {
          title: 'Warm-up',
          durationMinutes: 5,
          negativeMarkPercent: 0,
          partialScoring: false,
          questionIds: await mcqs(6, 7, 8),
        },
        {
          title: 'Problem solving',
          durationMinutes: 30,
          marksPerQuestion: 10,
          negativeMarkPercent: 0,
          partialScoring: true,
          questionIds: await codes(3, 4),
        },
      ],
    },
  ];

  const service = new ExamAdminService(db);
  let created = 0;
  for (const input of exams) {
    const exists = await db.exam.findFirst({
      where: { title: input.title, deletedAt: null },
      select: { id: true },
    });
    if (exists) continue;
    const exam = await service.create(null, input);
    await service.transition(null, exam.id, 'publish');
    created++;
  }
  return `${exams.length} (${created} new)`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
