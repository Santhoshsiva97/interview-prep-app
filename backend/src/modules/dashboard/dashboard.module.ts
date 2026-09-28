import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { ScorecardsModule } from '../scorecards/scorecards.module.js';
import { DashboardController } from './controllers/dashboard.controller.js';
import { DashboardService } from './services/dashboard.service.js';

@Module({
  imports: [ProfileModule, ScorecardsModule, AnalyticsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
