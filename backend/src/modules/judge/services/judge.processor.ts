import { Processor, WorkerHost } from '@nestjs/bullmq';
import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { EnvVars } from '../../../config/env.validation.js';
import { JUDGE_QUEUE, type JudgeJob } from '../models/judge.model.js';
import { JudgeService } from './judge.service.js';

/**
 * BullMQ worker for the `judge` queue (FRD §4.7). Scale out by running more
 * worker processes (JUDGE_WORKER_ENABLED) or raising JUDGE_WORKER_CONCURRENCY;
 * Judge0 itself has its own worker pool.
 */
@Processor(JUDGE_QUEUE)
export class JudgeProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly judge: JudgeService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {
    super();
  }

  onModuleInit() {
    this.worker.concurrency = this.config.get('JUDGE_WORKER_CONCURRENCY', {
      infer: true,
    });
  }

  process(job: Job<JudgeJob>): Promise<void> {
    return this.judge.process(job);
  }
}
