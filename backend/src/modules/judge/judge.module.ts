import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { redisOptionsFromUrl } from '../../queue/queue.module.js';
import { ExamsModule } from '../exams/exams.module.js';
import {
  AdminGradingController,
  CodeRunsController,
} from './controllers/judge.controller.js';
import { JUDGE_QUEUE } from './models/judge.model.js';
import {
  CODE_RUNNER,
  UnavailableCodeRunner,
  type CodeRunner,
} from './runners/code-runner.js';
import { Judge0CodeRunner } from './runners/judge0-runner.js';
import { LocalProcessCodeRunner } from './runners/local-runner.js';
import { JudgeService } from './services/judge.service.js';

export function createCodeRunner(
  config: ConfigService<EnvVars, true>,
): CodeRunner {
  switch (config.get('CODE_RUNNER', { infer: true })) {
    case 'judge0':
      return new Judge0CodeRunner({
        url: config.get('JUDGE0_URL', { infer: true }),
        authHeader: config.get('JUDGE0_AUTH_HEADER', { infer: true }),
        authToken: config.get('JUDGE0_AUTH_TOKEN', { infer: true }),
        timeoutMs: config.get('JUDGE0_TIMEOUT_SECONDS', { infer: true }) * 1000,
      });
    case 'local':
      return new LocalProcessCodeRunner();
    default:
      return new UnavailableCodeRunner();
  }
}

/**
 * Evaluation & code judge, producer side (FRD §4.7): runs, grading, the
 * `judge` queue and the code runner. The consumer (JudgeProcessor) lives in
 * JudgeWorkerModule.
 */
@Module({
  imports: [
    ExamsModule,
    BullModule.registerQueueAsync({
      name: JUDGE_QUEUE,
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
  controllers: [CodeRunsController, AdminGradingController],
  providers: [
    JudgeService,
    {
      provide: CODE_RUNNER,
      inject: [ConfigService],
      useFactory: createCodeRunner,
    },
  ],
  exports: [JudgeService, CODE_RUNNER],
})
export class JudgeModule {}
