import { Injectable, Logger } from '@nestjs/common';

/**
 * Session lifecycle events. Each is also written to exam_session_events in
 * the same transaction as the change; listeners run after it commits.
 */
export type ExamSessionEventType =
  /** Attempt created (after consent). */
  | 'started'
  /** Contact after a gap longer than the offline grace (dropped connection, closed tab…). */
  | 'resumed'
  /** Section-timed exams: the next section started (`data.reason`: `time` | `candidate`). */
  | 'section_advanced'
  /** Attempt closed (`data.reason`: manual | time_expired | abandoned). */
  | 'submitted'
  /** Fully evaluated by the judge (`data.scoreCenti`); scorecards build on it. Can fire again after a regrade. */
  | 'graded';

export interface ExamSessionEvent {
  type: ExamSessionEventType;
  sessionId: string;
  userId: string;
  examId: string;
  at: Date;
  data?: Record<string, unknown>;
}

export type ExamSessionListener = (event: ExamSessionEvent) => unknown;

/**
 * Hook point for modules that follow an attempt's lifecycle — Proctoring
 * (Step 14) subscribes here, grading (Step 8) listens for `submitted` and
 * scorecards (Step 9) for `graded`.
 * Listener errors are logged, never propagated to the candidate's request.
 */
@Injectable()
export class ExamSessionLifecycle {
  private readonly logger = new Logger(ExamSessionLifecycle.name);
  private readonly listeners = new Set<ExamSessionListener>();

  /** Returns an unsubscribe function. */
  subscribe(listener: ExamSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(events: ExamSessionEvent[]): Promise<void> {
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          await listener(event);
        } catch (err) {
          this.logger.error(
            `Listener failed for ${event.type} on session ${event.sessionId}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
  }
}
