import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  ANALYTICS_QUEUE,
  type AnalyticsJob,
} from '../models/analytics.model.js';
import { QuestionStatsService } from './question-stats.service.js';

/** Background aggregation worker (FRD §4.9): rebuilds question_stats. */
@Processor(ANALYTICS_QUEUE, { concurrency: 1 })
export class AnalyticsProcessor extends WorkerHost {
  constructor(private readonly stats: QuestionStatsService) {
    super();
  }

  process(job: Job<AnalyticsJob>): Promise<void> {
    return this.stats.process(job);
  }
}
