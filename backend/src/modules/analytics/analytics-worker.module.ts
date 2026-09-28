import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics.module.js';
import { AnalyticsProcessor } from './services/analytics.processor.js';

/** Analytics consumer, loaded when ANALYTICS_WORKER_ENABLED=true (the default). */
@Module({
  imports: [AnalyticsModule],
  providers: [AnalyticsProcessor],
})
export class AnalyticsWorkerModule {}
