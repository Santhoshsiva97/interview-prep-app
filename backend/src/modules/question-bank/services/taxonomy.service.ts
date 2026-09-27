import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { TagKind } from '../../../generated/prisma/enums.js';
import type {
  CreateTagDto,
  CreateTopicDto,
  UpdateTagDto,
  UpdateTopicDto,
} from '../models/taxonomy.dto.js';

export type TaxonomyErrorCode =
  'TOPIC_NOT_FOUND' | 'TAG_NOT_FOUND' | 'SLUG_TAKEN' | 'TOPIC_IN_USE';

const fail = (status: HttpStatus, code: TaxonomyErrorCode, message: string) =>
  new AppError<TaxonomyErrorCode>(status, code, message);

/** "Dynamic Programming" → "dynamic-programming". */
export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

const notDeleted = { deletedAt: null };

/** Topic & tag taxonomy for the question bank (FRD §4.11). */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  async listTopics() {
    const topics = await this.prisma.topic.findMany({
      where: notDeleted,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { questions: { where: notDeleted } } } },
    });
    return topics.map(({ _count, ...t }) => ({
      ...t,
      questionCount: _count.questions,
    }));
  }

  async createTopic(dto: CreateTopicDto) {
    const slug = dto.slug ?? slugify(dto.name);
    const existing = await this.prisma.topic.findUnique({ where: { slug } });
    if (existing && !existing.deletedAt) throw this.slugTaken(slug);
    const data = {
      name: dto.name,
      slug,
      description: dto.description ?? null,
      sortOrder: dto.sortOrder ?? 0,
    };
    // Re-creating a deleted topic revives it (slugs are unique across history).
    return existing
      ? this.prisma.topic.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
        })
      : this.prisma.topic.create({ data });
  }

  async updateTopic(id: string, dto: UpdateTopicDto) {
    await this.findTopic(id);
    if (dto.slug) await this.assertSlugFree('topic', dto.slug, id);
    return this.prisma.topic.update({ where: { id }, data: dto });
  }

  /** Only unused topics can be deleted (questions must keep a valid topic). */
  async deleteTopic(id: string): Promise<void> {
    await this.findTopic(id);
    const used = await this.prisma.question.count({
      where: { topicId: id, deletedAt: null },
    });
    if (used) {
      throw fail(
        HttpStatus.CONFLICT,
        'TOPIC_IN_USE',
        `${used} question${used === 1 ? '' : 's'} use this topic. Move them to another topic first.`,
      );
    }
    await this.prisma.topic.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async listTags(kind?: TagKind) {
    const tags = await this.prisma.tag.findMany({
      where: { ...notDeleted, ...(kind && { kind }) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    return tags.map(({ _count, ...t }) => ({
      ...t,
      questionCount: _count.questions,
    }));
  }

  async createTag(dto: CreateTagDto) {
    const slug = dto.slug ?? slugify(dto.name);
    const existing = await this.prisma.tag.findUnique({ where: { slug } });
    if (existing && !existing.deletedAt) throw this.slugTaken(slug);
    const data = { name: dto.name, slug, kind: dto.kind ?? 'skill' };
    return existing
      ? this.prisma.tag.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
        })
      : this.prisma.tag.create({ data });
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    await this.findTag(id);
    if (dto.slug) await this.assertSlugFree('tag', dto.slug, id);
    return this.prisma.tag.update({ where: { id }, data: dto });
  }

  /** Deleting a tag removes it from every question. */
  async deleteTag(id: string): Promise<void> {
    await this.findTag(id);
    await this.prisma.$transaction([
      this.prisma.questionTag.deleteMany({ where: { tagId: id } }),
      this.prisma.tag.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  private async findTopic(id: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id, ...notDeleted },
    });
    if (!topic)
      throw fail(HttpStatus.NOT_FOUND, 'TOPIC_NOT_FOUND', 'Topic not found.');
    return topic;
  }

  private async findTag(id: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, ...notDeleted },
    });
    if (!tag)
      throw fail(HttpStatus.NOT_FOUND, 'TAG_NOT_FOUND', 'Tag not found.');
    return tag;
  }

  private async assertSlugFree(
    kind: 'topic' | 'tag',
    slug: string,
    selfId: string,
  ) {
    const other =
      kind === 'topic'
        ? await this.prisma.topic.findUnique({ where: { slug } })
        : await this.prisma.tag.findUnique({ where: { slug } });
    if (other && other.id !== selfId) throw this.slugTaken(slug);
  }

  private slugTaken(slug: string) {
    return fail(
      HttpStatus.CONFLICT,
      'SLUG_TAKEN',
      `The slug “${slug}” is already used.`,
    );
  }
}
