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

    const total = await prisma.question.count({
      where: { deletedAt: null, externalId: { startsWith: 'seed-' } },
    });
    console.log(
      `Seeded ${seed.topics.length} topics, ${seed.tags.length} tags and ${report.totalRows} questions ` +
        `(${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged, ${published} published now). ` +
        `Sample questions in DB: ${total}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
