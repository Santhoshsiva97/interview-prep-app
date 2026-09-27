import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { TagKind } from '../../../generated/prisma/enums.js';
import type { FieldProblem } from '../models/question-content.js';
import { QuestionInputDto } from '../models/question-input.dto.js';
import {
  ImportFileError,
  parseImportFile,
  type ImportQuestion,
} from './import-format.js';
import { QuestionService } from './question.service.js';
import { slugify } from './taxonomy.service.js';

export interface ImportOptions {
  /** Validate and report only; write nothing. */
  dryRun: boolean;
  /** Put imported/updated questions straight into the review queue. */
  submitForReview: boolean;
  /** Create topics/tags that don't exist yet (otherwise they're row errors). */
  createMissingTaxonomy: boolean;
}

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface ImportRowResult {
  row: number;
  externalId: string | null;
  title: string | null;
  action: RowAction;
  questionId?: string;
  errors: FieldProblem[];
}

export interface ImportReport {
  importId: string | null;
  dryRun: boolean;
  format: 'csv' | 'json';
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  rows: ImportRowResult[];
  /** Topics/tags that were (or, in a dry run, would be) created. */
  newTaxonomy: { topics: string[]; tags: string[] };
}

const flatten = (errors: ValidationError[], prefix = ''): FieldProblem[] =>
  errors.flatMap((e) => {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((message) => ({
        field,
        message,
      })),
      ...flatten(e.children ?? [], field),
    ];
  });

/** Bulk question upload (FRD §4.11): CSV/JSON → per-row validation → upsert by externalId. */
@Injectable()
export class QuestionImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionService,
  ) {}

  async import(
    actor: AuthUser | null,
    file: { buffer: Buffer; originalname: string },
    opts: ImportOptions,
  ): Promise<ImportReport> {
    let parsed: ReturnType<typeof parseImportFile>;
    try {
      parsed = parseImportFile(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof ImportFileError) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'INVALID_IMPORT_FILE',
          err.message,
        );
      }
      throw err;
    }

    const taxonomy = await this.loadTaxonomy();
    const newTaxonomy = { topics: new Set<string>(), tags: new Set<string>() };
    const seenExternalIds = new Map<string, number>();
    const rows: ImportRowResult[] = [];

    for (const { row, question: raw, errors: readErrors } of parsed.rows) {
      const result: ImportRowResult = {
        row,
        externalId: raw?.externalId?.trim() || null,
        title: typeof raw?.title === 'string' ? raw.title.slice(0, 200) : null,
        action: 'error',
        errors: [...readErrors],
      };
      rows.push(result);
      if (!raw) continue;

      if (result.externalId) {
        if (result.externalId.length > 120) {
          result.errors.push({
            field: 'externalId',
            message: 'must be at most 120 characters',
          });
        }
        const firstRow = seenExternalIds.get(result.externalId);
        if (firstRow) {
          result.errors.push({
            field: 'externalId',
            message: `duplicate of row ${firstRow} in this file`,
          });
        } else {
          seenExternalIds.set(result.externalId, row);
        }
      }

      const input = await this.toInput(
        raw,
        taxonomy,
        opts,
        newTaxonomy,
        result.errors,
      );
      if (input)
        result.errors.push(...(await this.validateInput(input, taxonomy)));
      if (result.errors.length || !input) continue;

      try {
        await this.applyRow(actor, input, result, opts);
      } catch (err) {
        result.action = 'error';
        const details =
          err instanceof AppError
            ? (err.getResponse() as { errors?: FieldProblem[] })
            : {};
        result.errors.push(
          ...(details.errors ?? [
            { field: 'row', message: (err as Error).message },
          ]),
        );
      }
    }

    const count = (a: RowAction) => rows.filter((r) => r.action === a).length;
    const report: ImportReport = {
      importId: null,
      dryRun: opts.dryRun,
      format: parsed.format,
      fileName: file.originalname,
      totalRows: rows.length,
      created: count('create'),
      updated: count('update'),
      unchanged: count('unchanged'),
      failed: count('error'),
      rows,
      newTaxonomy: {
        topics: [...newTaxonomy.topics],
        tags: [...newTaxonomy.tags],
      },
    };

    if (!opts.dryRun) {
      const record = await this.prisma.questionImport.create({
        data: {
          uploadedById: actor?.id,
          fileName: file.originalname.slice(0, 255),
          format: parsed.format,
          totalRows: report.totalRows,
          createdCount: report.created,
          updatedCount: report.updated,
          unchangedCount: report.unchanged,
          errorCount: report.failed,
          errors: rows
            .filter((r) => r.action === 'error')
            .map(({ row, externalId, errors }) => ({
              row,
              externalId,
              errors,
            })) as unknown as Prisma.InputJsonValue,
        },
      });
      report.importId = record.id;
    }
    return report;
  }

  async history(limit = 20) {
    return this.prisma.questionImport.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  private async applyRow(
    actor: AuthUser | null,
    input: QuestionInputDto,
    result: ImportRowResult,
    opts: ImportOptions,
  ) {
    const existing = result.externalId
      ? await this.prisma.question.findFirst({
          where: { externalId: result.externalId, deletedAt: null },
          select: { id: true, type: true, status: true },
        })
      : null;

    if (existing && existing.type !== input.type) {
      result.errors.push({
        field: 'type',
        message: `externalId already used by a ${existing.type} question`,
      });
      return;
    }
    if (existing?.status === 'archived') {
      result.errors.push({
        field: 'externalId',
        message: 'that question is archived; restore it first',
      });
      return;
    }
    if (opts.dryRun) {
      result.action = existing ? 'update' : 'create'; // can't know "unchanged" without diffing
      result.questionId = existing?.id;
      return;
    }

    const saved = existing
      ? await this.questions.update(actor, existing.id, input)
      : await this.questions.create(actor, input, {
          externalId: result.externalId ?? undefined,
        });
    result.questionId = saved.question.id;
    result.action = !existing
      ? 'create'
      : saved.changed
        ? 'update'
        : 'unchanged';

    if (
      opts.submitForReview &&
      saved.changed &&
      ['draft', 'rejected'].includes(saved.question.status)
    ) {
      await this.questions.transition(actor, saved.question.id, 'submit');
    }
  }

  /** Converts a file row (names/slugs) into editor input (ids). */
  private async toInput(
    raw: ImportQuestion,
    taxonomy: Taxonomy,
    opts: ImportOptions,
    created: { topics: Set<string>; tags: Set<string> },
    errors: FieldProblem[],
  ): Promise<QuestionInputDto | null> {
    const topicName = typeof raw.topic === 'string' ? raw.topic.trim() : '';
    let topicId = topicName ? taxonomy.topic(topicName) : undefined;
    if (!topicName) {
      errors.push({ field: 'topic', message: 'is required' });
    } else if (!topicId) {
      if (opts.createMissingTaxonomy) {
        topicId = await this.ensureTopic(topicName, taxonomy, opts.dryRun);
        created.topics.add(topicName);
      } else {
        errors.push({
          field: 'topic',
          message: `“${topicName}” doesn’t exist (create it under Taxonomy first)`,
        });
      }
    }

    const tagIds: string[] = [];
    const rawTags = Array.isArray(raw.tags) ? raw.tags : [];
    for (const rawTag of rawTags) {
      if (typeof rawTag !== 'string' || !rawTag.trim()) continue;
      const isCompany = /^company:/i.test(rawTag.trim());
      const name = rawTag.trim().replace(/^company:\s*/i, '');
      let id = taxonomy.tag(name);
      if (!id) {
        if (opts.createMissingTaxonomy) {
          id = await this.ensureTag(
            name,
            isCompany ? 'company' : 'skill',
            taxonomy,
            opts.dryRun,
          );
          created.tags.add(rawTag.trim());
        } else {
          errors.push({
            field: 'tags',
            message: `tag “${name}” doesn’t exist`,
          });
          continue;
        }
      }
      if (!tagIds.includes(id)) tagIds.push(id);
    }

    if (!topicId) return null;
    return plainToInstance(QuestionInputDto, {
      type:
        typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : raw.type,
      title: raw.title,
      body: raw.body,
      topicId,
      difficulty:
        typeof raw.difficulty === 'string'
          ? raw.difficulty.trim().toLowerCase()
          : raw.difficulty,
      explanation: raw.explanation,
      marks: raw.marks ?? 1,
      tagIds,
      mcq: raw.mcq,
      coding: raw.coding && {
        timeLimitMs: raw.coding.timeLimitMs ?? 2000,
        memoryLimitMb: raw.coding.memoryLimitMb ?? 256,
        starterCode: raw.coding.starterCode,
        testCases: (raw.coding.testCases ?? []).map((t) => ({
          ...t,
          isSample: t.isSample ?? false,
          weight: t.weight ?? 1,
        })),
      },
      changeNote: 'Bulk import',
    });
  }

  private async validateInput(
    input: QuestionInputDto,
    taxonomy: Taxonomy,
  ): Promise<FieldProblem[]> {
    const shapeErrors = flatten(
      await validate(input, { whitelist: true, forbidNonWhitelisted: false }),
    );
    if (shapeErrors.length) return shapeErrors;
    const problems = await this.questions.problems(input);
    // Dry run: topics/tags that would be created don't exist yet — that's expected.
    const pending =
      taxonomy.isPlaceholder(input.topicId) ||
      input.tagIds.some((id) => taxonomy.isPlaceholder(id));
    return pending
      ? problems.filter((p) => p.field !== 'topicId' && p.field !== 'tagIds')
      : problems;
  }

  private async ensureTopic(name: string, taxonomy: Taxonomy, dryRun: boolean) {
    const slug = slugify(name);
    if (dryRun) return taxonomy.placeholder('topic', slug);
    const topic = await this.prisma.topic.upsert({
      where: { slug },
      create: { name, slug },
      update: { deletedAt: null },
    });
    taxonomy.addTopic(topic);
    return topic.id;
  }

  private async ensureTag(
    name: string,
    kind: TagKind,
    taxonomy: Taxonomy,
    dryRun: boolean,
  ) {
    const slug = slugify(name);
    if (dryRun) return taxonomy.placeholder('tag', slug);
    const tag = await this.prisma.tag.upsert({
      where: { slug },
      create: { name, slug, kind },
      update: { deletedAt: null },
    });
    taxonomy.addTag(tag);
    return tag.id;
  }

  private async loadTaxonomy(): Promise<Taxonomy> {
    const [topics, tags] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.tag.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true },
      }),
    ]);
    return new Taxonomy(topics, tags);
  }
}

/** Per-import, case-insensitive lookup of topics/tags by slug or name. */
class Taxonomy {
  private readonly topics = new Map<string, string>();
  private readonly tags = new Map<string, string>();
  /** Ids standing in for topics/tags a dry run would create. */
  private readonly placeholders = new Set<string>();

  constructor(
    topics: { id: string; name: string; slug: string }[],
    tags: { id: string; name: string; slug: string }[],
  ) {
    topics.forEach((t) => this.addTopic(t));
    tags.forEach((t) => this.addTag(t));
  }

  addTopic(t: { id: string; name: string; slug: string }) {
    this.topics.set(t.slug, t.id).set(t.name.toLowerCase(), t.id);
  }

  addTag(t: { id: string; name: string; slug: string }) {
    this.tags.set(t.slug, t.id).set(t.name.toLowerCase(), t.id);
  }

  topic(key: string) {
    return this.topics.get(key.toLowerCase()) ?? this.topics.get(slugify(key));
  }

  tag(key: string) {
    return this.tags.get(key.toLowerCase()) ?? this.tags.get(slugify(key));
  }

  /** Dry run: a stable fake id for a topic/tag that would be created. */
  placeholder(kind: 'topic' | 'tag', slug: string) {
    const id = randomUUID();
    this.placeholders.add(id);
    if (kind === 'topic') this.topics.set(slug, id);
    else this.tags.set(slug, id);
    return id;
  }

  isPlaceholder(id: string) {
    return this.placeholders.has(id);
  }
}
