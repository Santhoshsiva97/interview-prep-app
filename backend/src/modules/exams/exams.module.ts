import { Module } from '@nestjs/common';
import { AdminExamsController } from './controllers/admin-exams.controller.js';
import {
  ExamSessionsController,
  ExamsController,
} from './controllers/exams.controller.js';
import { ExamAdminService } from './services/exam-admin.service.js';
import { ExamCatalogService } from './services/exam-catalog.service.js';
import { ExamSessionLifecycle } from './services/exam-session-lifecycle.js';
import { ExamSessionSweeper } from './services/exam-session-sweeper.service.js';
import { ExamSessionService } from './services/exam-session.service.js';

/** Virtual interview & exam engine (FRD §4.6): builder, catalog, runtime sessions. */
@Module({
  controllers: [AdminExamsController, ExamsController, ExamSessionsController],
  providers: [
    ExamAdminService,
    ExamCatalogService,
    ExamSessionService,
    ExamSessionLifecycle,
    ExamSessionSweeper,
  ],
  // The judge (Step 8), scorecards (Step 9) and proctoring (Step 14) build on these.
  exports: [ExamSessionService, ExamSessionLifecycle],
})
export class ExamsModule {}
