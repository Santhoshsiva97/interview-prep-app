import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../database/redis.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  CodingResponse,
  McqResponse,
} from '../../exams/models/session-content.js';
import { ExamSessionLifecycle } from '../../exams/services/exam-session-lifecycle.js';
import { ExamSessionService } from '../../exams/services/exam-session.service.js';
import type {
  CodingContent,
  CodingLanguage,
  QuestionContent,
} from '../../question-bank/models/question-content.js';
import {
  JUDGE_QUEUE,
  type JudgeJob,
  type RunCodeDto,
  type StoredTestResult,
} from '../models/judge.model.js';
import {
  centiToMarks,
  effectiveLimits,
  gradeCoding,
  gradeMcq,
  overallVerdict,
  verdictFor,
  type Graded,
} from '../models/judging.js';
import { CODE_RUNNER, type CodeRunner } from '../runners/code-runner.js';

export type JudgeErrorCode =
  | 'JUDGE_UNAVAILABLE'
  | 'RUN_NOT_FOUND'
  | 'RUN_COOLDOWN'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_SUBMITTED';

const fail = (
  status: HttpStatus,
  code: JudgeErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new AppError<JudgeErrorCode>(status, code, message, details);

/** Stored outputs are truncated; hidden-test outputs are only ever shown to staff. */
const STORED_OUTPUT = 4096;
const clip = (s: string) =>
  s.length > STORED_OUTPUT ? `${s.slice(0, STORED_OUTPUT)}…` : s;

interface JobMeta {
  attempt: number;
  maxAttempts: number;
}

/**
 * Evaluation & code judge (FRD §4.7). Everything slow happens on the BullMQ
 * `judge` queue so submission spikes never block the API:
 * - "Run" (sample tests) → a `run` job; the client polls the submission.
 * - Submitting an attempt → a `grade` job (MCQ against the answer key,
 *   coding against sample + hidden tests), then the attempt's score.
 */
@Injectable()
export class JudgeService
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JudgeService.name);
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly runCooldownSeconds: number;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: ExamSessionService,
    private readonly lifecycle: ExamSessionLifecycle,
    @Inject(CODE_RUNNER) private readonly runner: CodeRunner,
    @InjectQueue(JUDGE_QUEUE) private readonly queue: Queue<JudgeJob>,
    private readonly config: ConfigService<EnvVars, true>,
  ) {
    this.maxAttempts = config.get('JUDGE_MAX_ATTEMPTS', { infer: true });
    this.retryDelayMs = config.get('JUDGE_RETRY_BASE_DELAY_MS', {
      infer: true,
    });
    this.runCooldownSeconds = config.get('CODE_RUN_COOLDOWN_SECONDS', {
      infer: true,
    });
  }

  onModuleInit() {
    // Grade every attempt as soon as it's submitted (manually, on time-out or abandoned).
    this.lifecycle.subscribe(async (e) => {
      if (e.type === 'submitted') await this.enqueueGrading(e.sessionId);
    });
  }

  onApplicationBootstrap() {
    if (!this.config.get('EXAM_SWEEPER_ENABLED', { infer: true })) return;
    const everyMs =
      this.config.get('EXAM_SWEEP_INTERVAL_SECONDS', { infer: true }) * 1000;
    this.recoveryTimer = setInterval(() => void this.recover(), everyMs);
    this.recoveryTimer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.recoveryTimer);
  }

  // ── Run (sample tests) ──

  /** Queues a run of the candidate's current code against the sample tests. 202 + poll. */
  async createRun(user: AuthUser, sessionId: string, dto: RunCodeDto) {
    const { item } = await this.sessions.runnableCodingItem(
      user,
      sessionId,
      dto.itemId,
    );
    const ok = await this.redis
      .set(`exam:run:${sessionId}`, '1', 'EX', this.runCooldownSeconds, 'NX')
      .catch(() => 'OK'); // Redis down: don't block the candidate.
    if (ok === null) {
      throw fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'RUN_COOLDOWN',
        'Please wait a moment before running again.',
        { retryAfterSeconds: this.runCooldownSeconds },
      );
    }
    const submission = await this.prisma.codeSubmission.create({
      data: {
        sessionId,
        sessionItemId: item.id,
        userId: user.id,
        kind: 'run',
        language: dto.language,
        source: dto.code,
      },
    });
    try {
      await this.queue.add(
        'run',
        { type: 'run', submissionId: submission.id },
        this.jobOptions(submission.id),
      );
    } catch (err) {
      await this.prisma.codeSubmission.update({
        where: { id: submission.id },
        data: { status: 'failed', error: 'Could not queue the run.' },
      });
      this.logger.error(`Could not queue run ${submission.id}: ${String(err)}`);
      throw fail(
        HttpStatus.SERVICE_UNAVAILABLE,
        'JUDGE_UNAVAILABLE',
        'The code judge is busy right now. Please try again in a moment.',
      );
    }
    return this.runView(submission);
  }

  async getRun(user: AuthUser, sessionId: string, runId: string) {
    const submission = await this.prisma.codeSubmission.findFirst({
      where: { id: runId, sessionId, userId: user.id, kind: 'run' },
    });
    if (!submission)
      throw fail(HttpStatus.NOT_FOUND, 'RUN_NOT_FOUND', 'Run not found.');
    return this.runView(submission);
  }

  // ── Grading ──

  /** Queues grading. Deduplicated per attempt by job id. */
  async enqueueGrading(sessionId: string) {
    try {
      await this.queue.add(
        'grade',
        { type: 'grade', sessionId },
        this.jobOptions(`grade-${sessionId}`),
      );
    } catch (err) {
      // Not fatal: `recover()` picks up attempts left pending.
      this.logger.error(
        `Could not queue grading for ${sessionId}: ${String(err)}`,
      );
    }
  }

  /** Admin: grade a submitted attempt again (e.g. after a judge outage or a fixed test case). */
  async regrade(sessionId: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      select: { status: true },
    });
    if (!s)
      throw fail(
        HttpStatus.NOT_FOUND,
        'SESSION_NOT_FOUND',
        'Attempt not found.',
      );
    if (s.status !== 'submitted') {
      throw fail(
        HttpStatus.CONFLICT,
        'SESSION_NOT_SUBMITTED',
        'Only submitted attempts can be graded.',
      );
    }
    await this.prisma.examSession.update({
      where: { id: sessionId },
      data: { gradingStatus: 'pending', gradingError: null },
    });
    await this.enqueueGrading(sessionId);
    return this.gradingReport(sessionId);
  }

  /** Staff view of an attempt's grading, including hidden-test verdicts. */
  async gradingReport(sessionId: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: {
          orderBy: [{ sectionIndex: 'asc' }, { position: 'asc' }],
          include: {
            questionVersion: { select: { title: true } },
            codeSubmissions: {
              where: { kind: 'grade' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!s)
      throw fail(
        HttpStatus.NOT_FOUND,
        'SESSION_NOT_FOUND',
        'Attempt not found.',
      );
    return {
      id: s.id,
      examId: s.examId,
      user: s.user,
      status: s.status,
      submitReason: s.submitReason,
      grading: {
        status: s.gradingStatus,
        score: centiToMarks(s.scoreCenti),
        maxScore: s.totalMarks,
        gradedAt: s.gradedAt,
        error: s.gradingError,
      },
      items: s.items.map((i) => {
        const sub = i.codeSubmissions[0];
        return {
          id: i.id,
          sectionIndex: i.sectionIndex,
          position: i.position,
          type: i.type,
          title: i.questionVersion.title,
          marks: i.marks,
          outcome: i.outcome,
          score: centiToMarks(i.scoreCenti),
          submission: sub && {
            id: sub.id,
            status: sub.status,
            language: sub.language,
            verdict: sub.verdict,
            passedCount: sub.passedCount,
            totalCount: sub.totalCount,
            passedWeight: sub.passedWeight,
            totalWeight: sub.totalWeight,
            compileOutput: sub.compileOutput,
            error: sub.error,
            results: sub.results,
          },
        };
      }),
    };
  }

  // ── Worker entry point ──

  /** Called by JudgeProcessor for every job. Throwing makes BullMQ retry with backoff. */
  async process(job: {
    data: JudgeJob;
    attemptsMade: number;
    opts: { attempts?: number };
  }): Promise<void> {
    const meta = {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    };
    if (job.data.type === 'run')
      await this.executeRun(job.data.submissionId, meta);
    else await this.gradeSession(job.data.sessionId, meta);
  }

  private async executeRun(submissionId: string, meta: JobMeta) {
    const sub = await this.prisma.codeSubmission.findUnique({
      where: { id: submissionId },
      include: {
        sessionItem: {
          include: { questionVersion: { select: { content: true } } },
        },
      },
    });
    if (!sub || sub.status === 'completed') return;
    await this.prisma.codeSubmission.update({
      where: { id: sub.id },
      data: {
        status: 'running',
        attempts: meta.attempt,
        startedAt: new Date(),
      },
    });
    const content = sub.sessionItem.questionVersion
      .content as unknown as QuestionContent;
    if (!('coding' in content)) {
      await this.prisma.codeSubmission.update({
        where: { id: sub.id },
        data: { status: 'failed', error: 'Not a coding question.' },
      });
      return;
    }
    const samples = content.coding.testCases.filter((t) => t.isSample);
    try {
      const result = await this.judge(
        sub.language as CodingLanguage,
        sub.source,
        content.coding,
        samples,
      );
      await this.saveSubmission(sub.id, result, samples);
    } catch (err) {
      await this.onJobError(err, meta, () =>
        this.prisma.codeSubmission.update({
          where: { id: sub.id },
          data:
            meta.attempt < meta.maxAttempts
              ? { status: 'queued' }
              : {
                  status: 'failed',
                  error: 'The code judge didn’t respond. Please try again.',
                  finishedAt: new Date(),
                },
        }),
      );
    }
  }

  /**
   * Grades a submitted attempt from its own copy of the questions (answer
   * keys and tests of the pinned versions, the marking scheme on each item).
   */
  private async gradeSession(sessionId: string, meta: JobMeta) {
    // Claim it, so a duplicate job finds nothing to do. The job id
    // (`grade-<session>`) means one grading job per attempt, so a *retry* of
    // it may take over an attempt left `grading` by its own failed try (e.g.
    // the DB was briefly unreachable when resetting it to `pending`).
    const claimed = await this.prisma.examSession.updateMany({
      where: {
        id: sessionId,
        status: 'submitted',
        gradingStatus:
          meta.attempt > 1 ? { in: ['pending', 'grading'] } : 'pending',
      },
      data: { gradingStatus: 'grading' },
    });
    if (claimed.count === 0) return;

    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        items: {
          include: { questionVersion: { select: { content: true } } },
        },
      },
    });
    let total = 0;
    const problems: string[] = [];
    let current: string | undefined;
    try {
      for (const item of session.items) {
        const content = item.questionVersion
          .content as unknown as QuestionContent;
        let graded: Graded | null;
        if ('mcq' in content) {
          const r = item.response as McqResponse | null;
          graded = gradeMcq(item, content.mcq.options, r?.optionIds ?? null);
        } else {
          const r = item.response as CodingResponse | null;
          const source = r ? r.sources[r.language] : undefined;
          if (!r || !source?.trim()) {
            graded = gradeCoding(item, null);
          } else {
            const sub = await this.prisma.codeSubmission.create({
              data: {
                sessionId,
                sessionItemId: item.id,
                userId: session.userId,
                kind: 'grade',
                status: 'running',
                language: r.language,
                source,
                attempts: meta.attempt,
                startedAt: new Date(),
              },
            });
            current = sub.id;
            const tests = content.coding.testCases;
            const result = await this.judge(
              r.language,
              source,
              content.coding,
              tests,
            );
            const verdicts = await this.saveSubmission(sub.id, result, tests);
            current = undefined;
            if (!verdicts) {
              problems.push(result.message ?? 'The code judge is unavailable.');
              graded = null;
            } else {
              graded = gradeCoding(
                item,
                verdicts.map((v, i) => ({
                  verdict: v,
                  weight: tests[i].weight,
                })),
              );
            }
          }
        }
        if (graded) {
          total += graded.scoreCenti;
          await this.prisma.examSessionItem.update({
            where: { id: item.id },
            data: {
              scoreCenti: graded.scoreCenti,
              outcome: graded.outcome,
              gradedAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      const inFlight = current;
      await this.onJobError(err, meta, async () => {
        if (inFlight) {
          await this.prisma.codeSubmission.update({
            where: { id: inFlight },
            data: {
              status: 'failed',
              error: String(err).slice(0, 1000),
              finishedAt: new Date(),
            },
          });
        }
        await this.prisma.examSession.update({
          where: { id: sessionId },
          data:
            meta.attempt < meta.maxAttempts
              ? { gradingStatus: 'pending' }
              : {
                  gradingStatus: 'failed',
                  gradingError: `Code judge error: ${String(err)}`.slice(
                    0,
                    1000,
                  ),
                },
        });
      });
      return;
    }

    const fullyGraded = problems.length === 0;
    await this.prisma.examSession.update({
      where: { id: sessionId },
      data: problems.length
        ? {
            // MCQs (and any code that did run) keep their scores; an admin can regrade.
            gradingStatus: 'failed',
            scoreCenti: null,
            gradingError: [...new Set(problems)].join(' ').slice(0, 1000),
          }
        : {
            gradingStatus: 'graded',
            scoreCenti: total,
            gradedAt: new Date(),
            gradingError: null,
          },
    });
    if (fullyGraded) {
      const at = new Date();
      const data = { scoreCenti: total };
      await this.prisma.examSessionEvent.create({
        data: { sessionId, type: 'graded', createdAt: at, data },
      });
      await this.lifecycle.emit([
        {
          type: 'graded',
          sessionId,
          userId: session.userId,
          examId: session.examId,
          at,
          data,
        },
      ]);
    }
  }

  /** Runs `tests` and returns the raw result (verdicts are assigned in `saveSubmission`). */
  private judge(
    language: CodingLanguage,
    source: string,
    coding: CodingContent,
    tests: { input: string }[],
  ) {
    return this.runner.run({
      language,
      source,
      inputs: tests.map((t) => t.input),
      ...effectiveLimits(language, coding.timeLimitMs, coding.memoryLimitMb),
    });
  }

  /** Stores the outcome of a submission. Returns per-test verdicts, or null if it couldn't run. */
  private async saveSubmission(
    id: string,
    result: Awaited<ReturnType<CodeRunner['run']>>,
    tests: {
      input: string;
      expectedOutput: string;
      isSample: boolean;
      weight: number;
    }[],
  ) {
    if (result.status === 'unavailable') {
      await this.prisma.codeSubmission.update({
        where: { id },
        data: {
          status: 'failed',
          error: (result.message ?? 'The code judge is unavailable.').slice(
            0,
            1000,
          ),
          finishedAt: new Date(),
        },
      });
      return null;
    }
    const verdicts = result.outcomes.map((o, i) =>
      verdictFor(o, tests[i].expectedOutput),
    );
    const stored: StoredTestResult[] = result.outcomes.map((o, i) => ({
      index: i,
      isSample: tests[i].isSample,
      verdict: verdicts[i],
      timeMs: o.timeMs,
      memoryKb: o.memoryKb,
      stdout: clip(o.stdout),
      stderr: clip(o.stderr),
      ...(tests[i].isSample && {
        input: tests[i].input,
        expectedOutput: tests[i].expectedOutput,
      }),
    }));
    const passed = verdicts
      .map((v, i) => ({ v, w: tests[i].weight }))
      .filter((x) => x.v === 'AC');
    await this.prisma.codeSubmission.update({
      where: { id },
      data: {
        status: 'completed',
        verdict: overallVerdict(verdicts),
        passedCount: passed.length,
        totalCount: verdicts.length,
        passedWeight: passed.reduce((a, x) => a + x.w, 0),
        totalWeight: tests.reduce((a, t) => a + t.weight, 0),
        compileOutput: result.compileOutput ? clip(result.compileOutput) : null,
        results: stored as unknown as Prisma.InputJsonValue,
        error: null,
        finishedAt: new Date(),
      },
    });
    return verdicts;
  }

  /** Records the failure, then rethrows so BullMQ retries — unless this was the last attempt. */
  private async onJobError(
    err: unknown,
    meta: JobMeta,
    record: () => Promise<unknown>,
  ) {
    await record();
    const last = meta.attempt >= meta.maxAttempts;
    this.logger.warn(
      `Judge job failed (attempt ${meta.attempt}/${meta.maxAttempts}${last ? ', giving up' : ''}): ${String(err)}`,
    );
    if (!last) throw err;
  }

  /**
   * Re-queues grading that got lost: attempts left `pending` (queue was down
   * at submit time) or stuck in `grading` (a worker died mid-job).
   */
  async recover(now = new Date()) {
    try {
      const stale = await this.prisma.examSession.findMany({
        where: {
          status: 'submitted',
          OR: [
            {
              gradingStatus: 'pending',
              updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) },
            },
            {
              gradingStatus: 'grading',
              updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
            },
          ],
        },
        select: { id: true, gradingStatus: true },
        take: 50,
      });
      for (const s of stale) {
        if (s.gradingStatus === 'grading') {
          await this.prisma.examSession.updateMany({
            where: { id: s.id, gradingStatus: 'grading' },
            data: { gradingStatus: 'pending' },
          });
        }
        await this.enqueueGrading(s.id);
      }
      return stale.length;
    } catch (err) {
      this.logger.error(`Grading recovery failed: ${String(err)}`);
      return 0;
    }
  }

  private jobOptions(jobId: string) {
    return {
      jobId,
      attempts: this.maxAttempts,
      backoff: { type: 'exponential' as const, delay: this.retryDelayMs },
      // Outcomes live in Postgres; finished jobs free their id for regrades.
      removeOnComplete: true,
      removeOnFail: true,
    };
  }

  /** What the candidate sees of a run: sample tests only, with their outputs. */
  private runView(s: {
    id: string;
    status: string;
    language: string;
    verdict: string | null;
    passedCount: number | null;
    totalCount: number | null;
    compileOutput: string | null;
    error: string | null;
    results: Prisma.JsonValue;
    createdAt: Date;
  }) {
    const results = ((s.results ?? []) as unknown as StoredTestResult[]).filter(
      (r) => r.isSample,
    );
    return {
      id: s.id,
      status: s.status,
      language: s.language,
      verdict: s.verdict,
      passedCount: s.passedCount,
      totalCount: s.totalCount,
      compileOutput: s.compileOutput,
      message: s.error,
      createdAt: s.createdAt,
      results: results.map((r) => ({
        verdict: r.verdict,
        timeMs: r.timeMs,
        memoryKb: r.memoryKb,
        stdout: r.stdout,
        stderr: r.stderr,
        input: r.input ?? '',
        expectedOutput: r.expectedOutput ?? '',
      })),
    };
  }
}
