import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { redisOptionsFromUrl } from '../../queue/queue.module.js';
import {
  AdminAnalyticsController,
  InsightsController,
} from './controllers/analytics.controller.js';
import { ANALYTICS_QUEUE } from './models/analytics.model.js';
import { InsightsService } from './services/insights.service.js';
import { PlatformAnalyticsService } from './services/platform-analytics.service.js';
import { QuestionStatsService } from './services/question-stats.service.js';

/**
 * Insights & analytics (FRD §4.9): candidate insights, platform KPIs and
 * question-quality stats (producer side of the `analytics` queue; the
 * worker lives in AnalyticsWorkerModule).
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: ANALYTICS_QUEUE,
      inject: [ConfigService],
      // Producer connection fails fast when Redis is down (see MailModule).
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        connection: {
          ...redisOptionsFromUrl(config.get('REDIS_URL', { infer: true })),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        },
      }),
    }),
  ],
  controllers: [AdminAnalyticsController, InsightsController],
  providers: [PlatformAnalyticsService, QuestionStatsService, InsightsService],
  exports: [PlatformAnalyticsService, QuestionStatsService, InsightsService],
})
export class AnalyticsModule {}
