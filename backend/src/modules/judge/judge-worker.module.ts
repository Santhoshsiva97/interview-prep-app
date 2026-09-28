import { Module } from '@nestjs/common';
import { JudgeModule } from './judge.module.js';
import { JudgeProcessor } from './services/judge.processor.js';

/** Judge consumer, loaded when JUDGE_WORKER_ENABLED=true (the default). */
@Module({
  imports: [JudgeModule],
  providers: [JudgeProcessor],
})
export class JudgeWorkerModule {}
