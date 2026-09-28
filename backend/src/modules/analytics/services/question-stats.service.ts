import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { AppError } from '../../../common/errors/app-error.js';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ANALYTICS_QUEUE,
  QUESTION_STATS_JOB,
  type AnalyticsJob,
  type QuestionStatsQueryDto,
} from '../models/analytics.model.js';

/** Flags need at least this many attempts to mean anything. */
export const MIN_ATTEMPTS_FOR_FLAGS = 5;
export const TOO_EASY_BP = 9000;
export const TOO_HARD_BP = 2000;
/** Upper bound on rows an analytics view (or its CSV) returns. */
const MAX_ROWS = 5000;

export type QuestionFlag = 'too_easy' | 'too_hard' | 'unused';

/**
 * Question-quality analytics (FRD §4.9). `question_stats` is derived data,
 * rebuilt by a background job on the `analytics` queue from every graded
 * attempt: every ANALYTICS_REFRESH_MINUTES, and on demand from the admin UI.
 */
@Injectable()
export class QuestionStatsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(QuestionStatsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYTICS_QUEUE) private readonly queue: Queue<AnalyticsJob>,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  onApplicationBootstrap() {
    const minutes = this.config.get('ANALYTICS_REFRESH_MINUTES', {
      infer: true,
    });
    if (!minutes) return;
    void this.enqueueRefresh();
    this.timer = setInterval(
      () => void this.enqueueRefresh(),
      minutes * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Queues a rebuild. Deduplicated: one refresh job waits at a time. */
  async enqueueRefresh(): Promise<boolean> {
    try {
      await this.queue.add(
        QUESTION_STATS_JOB,
        { type: QUESTION_STATS_JOB },
        {
          jobId: QUESTION_STATS_JOB,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not queue the question-stats refresh: ${String(err)}`,
      );
      return false;
    }
  }

  /** Admin "Refresh now". */
  async requestRefresh() {
    if (!(await this.enqueueRefresh())) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ANALYTICS_UNAVAILABLE',
        'Couldn’t start the refresh. Please try again in a moment.',
      );
    }
    return { queued: true, lastComputedAt: await this.lastComputedAt() };
  }

  /** Worker entry point. */
  async process(job: { data: AnalyticsJob }) {
    if (job.data.type === QUESTION_STATS_JOB) await this.recompute();
  }

  /**
   * Rebuilds question_stats from graded attempts in one statement, then
   * drops rows for questions that no longer have any. Rates in basis points;
   * a negative score counts as 0 for the average-score rate.
   */
  async recompute(now = new Date()) {
    const upserted = await this.prisma.$executeRaw`
      INSERT INTO question_stats (
        question_id, attempts, answered, correct, partial, incorrect,
        accuracy_bp, avg_score_bp, avg_time_ms, last_attempt_at, computed_at, updated_at
      )
      SELECT
        i.question_id,
        count(*)::int,
        count(*) FILTER (WHERE i.outcome <> 'unanswered')::int,
        count(*) FILTER (WHERE i.outcome = 'correct')::int,
        count(*) FILTER (WHERE i.outcome = 'partial')::int,
        count(*) FILTER (WHERE i.outcome = 'incorrect')::int,
        COALESCE(round(10000.0 * count(*) FILTER (WHERE i.outcome = 'correct')
          / NULLIF(count(*) FILTER (WHERE i.outcome <> 'unanswered'), 0)), 0)::int,
        COALESCE(round(avg(GREATEST(i.score_centi, 0) * 100.0 / NULLIF(i.marks, 0))
          FILTER (WHERE i.outcome <> 'unanswered')), 0)::int,
        COALESCE(round(avg(i.time_spent_ms) FILTER (WHERE i.outcome <> 'unanswered')), 0)::int,
        max(s.submitted_at),
        ${now},
        ${now}
      FROM exam_session_items i
      JOIN exam_sessions s ON s.id = i.session_id
      WHERE s.grading_status = 'graded' AND s.deleted_at IS NULL AND i.outcome IS NOT NULL
      GROUP BY i.question_id
      ON CONFLICT (question_id) DO UPDATE SET
        attempts = EXCLUDED.attempts,
        answered = EXCLUDED.answered,
        correct = EXCLUDED.correct,
        partial = EXCLUDED.partial,
        incorrect = EXCLUDED.incorrect,
        accuracy_bp = EXCLUDED.accuracy_bp,
        avg_score_bp = EXCLUDED.avg_score_bp,
        avg_time_ms = EXCLUDED.avg_time_ms,
        last_attempt_at = EXCLUDED.last_attempt_at,
        computed_at = EXCLUDED.computed_at,
        updated_at = EXCLUDED.updated_at`;
    await this.prisma.questionStat.deleteMany({
      where: { computedAt: { lt: now } },
    });
    this.logger.log(`question_stats rebuilt for ${upserted} question(s)`);
    return upserted;
  }

  async lastComputedAt() {
    const row = await this.prisma.questionStat.findFirst({
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    return row?.computedAt ?? null;
  }

  /** The analytics table: live questions with their stats (or none yet), filtered and sorted. */
  async list(q: QuestionStatsQueryDto) {
    const where: Prisma.QuestionWhereInput = {
      deletedAt: null,
      publishedVersionId: { not: null },
      ...(q.type && { type: q.type }),
      ...(q.topicId && { topicId: q.topicId }),
      ...(q.difficulty && { difficulty: q.difficulty }),
      ...(q.search && { title: { contains: q.search, mode: 'insensitive' } }),
    };
    const questions = await this.prisma.question.findMany({
      where,
      take: MAX_ROWS,
      select: {
        id: true,
        title: true,
        type: true,
        difficulty: true,
        topic: { select: { id: true, name: true } },
        stats: true,
      },
    });
    const rows = questions
      .map((x) => {
        const s = x.stats;
        const flags: QuestionFlag[] = [];
        if (!s || s.attempts === 0) flags.push('unused');
        else if (s.answered >= MIN_ATTEMPTS_FOR_FLAGS) {
          if (s.accuracyBp >= TOO_EASY_BP) flags.push('too_easy');
          if (s.accuracyBp <= TOO_HARD_BP) flags.push('too_hard');
        }
        return {
          questionId: x.id,
          title: x.title,
          type: x.type,
          difficulty: x.difficulty,
          topic: x.topic,
          attempts: s?.attempts ?? 0,
          answered: s?.answered ?? 0,
          correct: s?.correct ?? 0,
          partial: s?.partial ?? 0,
          incorrect: s?.incorrect ?? 0,
          /** Percentages (0–100); null until the question has been answered. */
          accuracy: s && s.answered ? s.accuracyBp / 100 : null,
          avgScore: s && s.answered ? s.avgScoreBp / 100 : null,
          avgTimeMs: s && s.answered ? s.avgTimeMs : null,
          lastAttemptAt: s?.lastAttemptAt ?? null,
          flags,
        };
      })
      .filter((r) => !q.flag || r.flags.includes(q.flag));

    const dir = q.dir === 'asc' ? 1 : -1;
    const key = (r: (typeof rows)[number]): number | string | null =>
      q.sort === 'accuracy'
        ? r.accuracy
        : q.sort === 'avg_time'
          ? r.avgTimeMs
          : q.sort === 'title'
            ? r.title.toLowerCase()
            : r.attempts;
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      // Questions with no data yet go last in either direction.
      if (ka === null || kb === null)
        return ka === kb
          ? a.title.localeCompare(b.title)
          : ka === null
            ? 1
            : -1;
      return (
        (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || a.title.localeCompare(b.title)
      );
    });
    return {
      rows,
      total: rows.length,
      computedAt: await this.lastComputedAt(),
      thresholds: {
        minAttempts: MIN_ATTEMPTS_FOR_FLAGS,
        tooEasy: TOO_EASY_BP / 100,
        tooHard: TOO_HARD_BP / 100,
      },
    };
  }
}
