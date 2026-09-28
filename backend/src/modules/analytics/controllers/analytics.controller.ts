import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import {
  FormatQueryDto,
  OverviewQueryDto,
  QuestionStatsQueryDto,
} from '../models/analytics.model.js';
import { sendCsv, toCsv } from '../models/csv.js';
import { InsightsService } from '../services/insights.service.js';
import { PlatformAnalyticsService } from '../services/platform-analytics.service.js';
import { QuestionStatsService } from '../services/question-stats.service.js';

const today = () => new Date().toISOString().slice(0, 10);
const seconds = (ms: number | null) =>
  ms === null ? null : Math.round(ms / 100) / 10;

/** Admin analytics (FRD §4.9). Every view also exports as CSV (`?format=csv`). */
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly platform: PlatformAnalyticsService,
    private readonly questions: QuestionStatsService,
  ) {}

  /** KPIs + a daily series (sign-ups, active users, attempts, average score). */
  @Get('overview')
  @Roles('admin', 'support')
  async overview(
    @Query() q: OverviewQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const daily = await this.platform.daily(q.days);
    if (q.format === 'csv') {
      return sendCsv(
        res,
        `platform-daily-${today()}.csv`,
        toCsv(daily, [
          { header: 'day_utc', value: (r) => r.day },
          { header: 'signups', value: (r) => r.signups },
          { header: 'active_users', value: (r) => r.activeUsers },
          { header: 'attempts_started', value: (r) => r.attemptsStarted },
          { header: 'attempts_submitted', value: (r) => r.attemptsSubmitted },
          { header: 'avg_percent', value: (r) => r.avgPercent },
        ]),
      );
    }
    return { kpis: await this.platform.kpis(), daily };
  }

  /** Question quality: attempts, accuracy, average score and time per question. */
  @Get('questions')
  @Roles('editor', 'admin')
  async questionStats(
    @Query() q: QuestionStatsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.questions.list(q);
    if (q.format === 'csv') {
      return sendCsv(
        res,
        `question-stats-${today()}.csv`,
        toCsv(result.rows, [
          { header: 'question_id', value: (r) => r.questionId },
          { header: 'title', value: (r) => r.title },
          { header: 'type', value: (r) => r.type },
          { header: 'difficulty', value: (r) => r.difficulty },
          { header: 'topic', value: (r) => r.topic.name },
          { header: 'attempts', value: (r) => r.attempts },
          { header: 'answered', value: (r) => r.answered },
          { header: 'correct', value: (r) => r.correct },
          { header: 'partial', value: (r) => r.partial },
          { header: 'incorrect', value: (r) => r.incorrect },
          { header: 'accuracy_percent', value: (r) => r.accuracy },
          { header: 'avg_score_percent', value: (r) => r.avgScore },
          { header: 'avg_time_seconds', value: (r) => seconds(r.avgTimeMs) },
          { header: 'flags', value: (r) => r.flags.join(' ') },
        ]),
      );
    }
    return result;
  }

  /** Queue a question-stats rebuild now (it also runs on a timer). */
  @Post('questions/refresh')
  @Roles('editor', 'admin')
  @HttpCode(HttpStatus.ACCEPTED)
  refresh() {
    return this.questions.requestRefresh();
  }
}

/** Candidate insights (FRD §4.9). */
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Strengths/weaknesses by topic & difficulty, trend, recommendations. CSV = the topic table. */
  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Query() q: FormatQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.insights.forUser(user.id);
    if (q.format === 'csv') {
      return sendCsv(
        res,
        `my-topic-insights-${today()}.csv`,
        toCsv(result.topics, [
          { header: 'topic', value: (r) => r.name },
          { header: 'strength', value: (r) => r.strength },
          { header: 'mastery_percent', value: (r) => r.mastery },
          { header: 'accuracy_percent', value: (r) => r.accuracy },
          { header: 'questions', value: (r) => r.questions },
          { header: 'answered', value: (r) => r.answered },
          { header: 'correct', value: (r) => r.correct },
          { header: 'avg_time_seconds', value: (r) => seconds(r.avgTimeMs) },
        ]),
      );
    }
    return result;
  }
}
