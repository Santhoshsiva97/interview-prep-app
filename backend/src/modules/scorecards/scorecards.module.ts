import { Module } from '@nestjs/common';
import { ExamsModule } from '../exams/exams.module.js';
import { ScorecardsController } from './controllers/scorecards.controller.js';
import { ScorecardService } from './services/scorecard.service.js';

/** Scorecards (FRD §4.8): built from graded attempts, shown in History & Scorecards. */
@Module({
  imports: [ExamsModule],
  controllers: [ScorecardsController],
  providers: [ScorecardService],
  // Dashboard (recent activity) and analytics (Step 10) read from it.
  exports: [ScorecardService],
})
export class ScorecardsModule {}
