import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { AdminExamsController } from './controllers/admin-exams.controller.js';
import {
  ExamSessionsController,
  ExamsController,
} from './controllers/exams.controller.js';
import {
  CODE_RUNNER,
  LocalProcessCodeRunner,
  UnavailableCodeRunner,
} from './services/code-runner.js';
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
    {
      // STEP 8 HOOK: bind the sandboxed judge here.
      provide: CODE_RUNNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        config.get('CODE_RUNNER', { infer: true }) === 'local'
          ? new LocalProcessCodeRunner()
          : new UnavailableCodeRunner(),
    },
  ],
  // Grading (Step 8), scorecards (Step 9) and proctoring (Step 14) build on these.
  exports: [ExamSessionService, ExamSessionLifecycle, CODE_RUNNER],
})
export class ExamsModule {}
