import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env.validation.js';
import { ExamSessionService } from './exam-session.service.js';

/**
 * Periodically closes attempts whose time ran out while the candidate was
 * away (FRD §4.6 auto-submit). Idempotent and lock-safe, so running it on
 * several API instances at once is fine. Attempts are also closed lazily
 * whenever the candidate's client makes contact.
 */
@Injectable()
export class ExamSessionSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ExamSessionSweeper.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly sessions: ExamSessionService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get('EXAM_SWEEPER_ENABLED', { infer: true })) return;
    const everyMs =
      this.config.get('EXAM_SWEEP_INTERVAL_SECONDS', { infer: true }) * 1000;
    this.timer = setInterval(() => void this.runOnce(), everyMs);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const closed = await this.sessions.sweep();
      if (closed)
        this.logger.log(`Auto-submitted ${closed} expired attempt(s)`);
    } catch (err) {
      this.logger.error(
        'Exam session sweep failed',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }
}
