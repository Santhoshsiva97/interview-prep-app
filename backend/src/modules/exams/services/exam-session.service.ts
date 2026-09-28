import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import type { EnvVars } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../database/redis.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { ExamSubmitReason } from '../../../generated/prisma/enums.js';
import type { QuestionContent } from '../../question-bank/models/question-content.js';
import {
  advanceSection,
  initialClock,
  tick,
  type ClockConfig,
  type ClockState,
  type ClockTick,
} from '../models/exam-clock.js';
import {
  examDetailInclude,
  itemMarks,
  type ExamWithSections,
} from '../models/exam.model.js';
import {
  candidateQuestion,
  normaliseResponse,
  sectionDurationsMs,
  shuffled,
  type SessionSnapshot,
} from '../models/session-content.js';
import type {
  AnswerDto,
  RunCodeDto,
  SubmitSessionDto,
} from '../models/session.dto.js';
import { CODE_RUNNER, type CodeRunner } from './code-runner.js';
import {
  ExamSessionLifecycle,
  type ExamSessionEvent,
  type ExamSessionEventType,
} from './exam-session-lifecycle.js';

export type ExamSessionErrorCode =
  | 'EXAM_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'ATTEMPT_LIMIT_REACHED'
  | 'NOT_SECTION_TIMED'
  | 'ITEM_NOT_FOUND'
  | 'NOT_CODING_QUESTION'
  | 'SECTION_LOCKED'
  | 'RUN_COOLDOWN';

const fail = (
  status: HttpStatus,
  code: ExamSessionErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new AppError<ExamSessionErrorCode>(status, code, message, details);

type Tx = Prisma.TransactionClient;

const sessionSelect = {
  id: true,
  examId: true,
  userId: true,
  attemptNumber: true,
  status: true,
  startedAt: true,
  consentedAt: true,
  timeRemainingMs: true,
  sectionRemainingMs: true,
  currentSectionIndex: true,
  lastSyncedAt: true,
  submittedAt: true,
  submitReason: true,
  snapshot: true,
  totalMarks: true,
} satisfies Prisma.ExamSessionSelect;

type SessionRow = Prisma.ExamSessionGetPayload<{
  select: typeof sessionSelect;
}>;

export interface RejectedAnswer {
  itemId: string;
  code: 'ITEM_NOT_FOUND' | 'SECTION_LOCKED' | 'INVALID_ANSWER';
  message: string;
}

/** Result of any contact that syncs the clock (autosave, submit…). */
export interface SyncResult {
  status: 'in_progress' | 'submitted';
  submitReason: ExamSubmitReason | null;
  timeRemainingMs: number;
  sectionRemainingMs: number | null;
  currentSectionIndex: number;
  serverTime: Date;
  rejected: RejectedAnswer[];
}

/**
 * Candidate side of the exam engine (FRD §4.6): start/resume, autosave,
 * timed sections, submit, and running code against sample cases.
 *
 * Every state change runs in a transaction holding a row lock on the
 * session, so autosaves, submits and the expiry sweep never interleave.
 */
@Injectable()
export class ExamSessionService {
  private readonly graceMs: number;
  private readonly autosaveMs: number;
  private readonly abandonAfterMs: number;
  private readonly runCooldownSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly lifecycle: ExamSessionLifecycle,
    @Inject(CODE_RUNNER) private readonly runner: CodeRunner,
    config: ConfigService<EnvVars, true>,
  ) {
    this.autosaveMs =
      config.get('EXAM_AUTOSAVE_INTERVAL_SECONDS', { infer: true }) * 1000;
    this.graceMs =
      config.get('EXAM_OFFLINE_GRACE_SECONDS', { infer: true }) * 1000;
    this.abandonAfterMs =
      config.get('EXAM_ABANDON_AFTER_HOURS', { infer: true }) * 3_600_000;
    this.runCooldownSeconds = config.get('CODE_RUN_COOLDOWN_SECONDS', {
      infer: true,
    });
  }

  // ── Start ──

  /**
   * Starts an attempt after consent, or returns the candidate's attempt
   * already in progress (one at a time per exam).
   */
  async start(user: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, status: 'published', deletedAt: null },
      include: examDetailInclude,
    });
    if (!exam)
      throw fail(HttpStatus.NOT_FOUND, 'EXAM_NOT_FOUND', 'Exam not found.');

    const now = new Date();
    const events: ExamSessionEvent[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent starts (double click, two tabs) for this user+exam.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exam-start:${user.id}:${examId}`}))`;
      const existing = await tx.examSession.findFirst({
        where: { userId: user.id, examId, status: 'in_progress' },
        select: { id: true },
      });
      if (existing) return { sessionId: existing.id, resumed: true };

      const attempts = await tx.examSession.count({
        where: { userId: user.id, examId },
      });
      if (exam.maxAttempts !== null && attempts >= exam.maxAttempts) {
        throw fail(
          HttpStatus.CONFLICT,
          'ATTEMPT_LIMIT_REACHED',
          `You’ve used all ${exam.maxAttempts} attempt${exam.maxAttempts === 1 ? '' : 's'} for this exam.`,
        );
      }

      const snapshot = this.snapshotOf(exam);
      const clock = initialClock(
        exam.durationMinutes * 60_000,
        { sectionDurationsMs: sectionDurationsMs(snapshot) },
        now,
      );
      const items = this.itemRows(exam);
      const session = await tx.examSession.create({
        data: {
          examId,
          userId: user.id,
          attemptNumber: attempts + 1,
          consentedAt: now,
          startedAt: now,
          ...clock,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          totalMarks: items.reduce((a, i) => a + i.marks, 0),
          items: { createMany: { data: items } },
        },
        select: sessionSelect,
      });
      events.push(
        await this.record(tx, session, 'started', now, {
          attemptNumber: session.attemptNumber,
        }),
      );
      return { sessionId: session.id, resumed: false };
    });
    await this.lifecycle.emit(events);
    return result;
  }

  // ── Runtime ──

  /**
   * Runtime (re)connects: charges the clock, then returns everything needed
   * to render the attempt, including saved answers.
   */
  async resume(user: AuthUser, id: string) {
    await this.mutate(user, id, (tx, s, now, events) =>
      this.sync(tx, s, now, [], { requireOpen: false }, events),
    );
    return this.view(user, id);
  }

  /** Read-only view (no clock charge): the clock is projected to now. */
  async view(user: AuthUser, id: string) {
    const s = await this.findOwned(user, id);
    const snapshot = s.snapshot as unknown as SessionSnapshot;
    const now = new Date();
    const clock =
      s.status === 'in_progress'
        ? tick(this.clockState(s), this.clockConfig(snapshot), now)
        : this.clockState(s);
    const open = s.status === 'in_progress';
    const items = await this.prisma.examSessionItem.findMany({
      where: { sessionId: id },
      orderBy: [{ sectionIndex: 'asc' }, { position: 'asc' }],
      include: {
        questionVersion: {
          select: { title: true, body: true, difficulty: true, content: true },
        },
      },
    });
    const accessible = (sectionIndex: number) =>
      open &&
      (!snapshot.settings.sectionTimed ||
        sectionIndex === clock.currentSectionIndex);

    return {
      id: s.id,
      examId: s.examId,
      status: s.status,
      submitReason: s.submitReason,
      submittedAt: s.submittedAt,
      startedAt: s.startedAt,
      attemptNumber: s.attemptNumber,
      exam: {
        title: snapshot.settings.title,
        kind: snapshot.settings.kind,
        durationMinutes: snapshot.settings.durationMinutes,
        sectionTimed: snapshot.settings.sectionTimed,
        pauseOnDisconnect: snapshot.settings.pauseOnDisconnect,
      },
      sections: snapshot.sections.map((sec, index) => ({
        index,
        title: sec.title,
        description: sec.description,
        durationMinutes: sec.durationMinutes,
        questionCount: sec.questionCount,
        negativeMarkPercent: sec.negativeMarkPercent,
        state: !snapshot.settings.sectionTimed
          ? 'open'
          : index < clock.currentSectionIndex
            ? 'done'
            : index === clock.currentSectionIndex
              ? 'current'
              : 'upcoming',
      })),
      currentSectionIndex: clock.currentSectionIndex,
      timeRemainingMs: clock.timeRemainingMs,
      sectionRemainingMs: clock.sectionRemainingMs,
      serverTime: now,
      autosaveIntervalMs: this.autosaveMs,
      totalMarks: s.totalMarks,
      items: items.map((i) => ({
        id: i.id,
        sectionIndex: i.sectionIndex,
        position: i.position,
        type: i.type,
        marks: i.marks,
        negativeMarkPercent: i.negativeMarkPercent,
        markedForReview: i.markedForReview,
        visited: i.visitedAt !== null,
        answered: i.response !== null,
        timeSpentMs: i.timeSpentMs,
        response: accessible(i.sectionIndex) ? i.response : null,
        /** Null when locked (other timed section) or after submission. */
        question: accessible(i.sectionIndex)
          ? candidateQuestion(
              i.questionVersion,
              (i.optionOrder as string[] | null) ?? null,
            )
          : null,
      })),
    };
  }

  /** Autosave (every EXAM_AUTOSAVE_INTERVAL_SECONDS, and on leaving the page). */
  save(user: AuthUser, id: string, answers: AnswerDto[]) {
    return this.mutate(user, id, (tx, s, now, events) =>
      this.sync(tx, s, now, answers, { requireOpen: true }, events),
    );
  }

  /** Section-timed exams: finish the current section early (it locks). */
  nextSection(user: AuthUser, id: string, answers: AnswerDto[] = []) {
    return this.mutate(user, id, async (tx, s, now, events) => {
      const snapshot = s.snapshot as unknown as SessionSnapshot;
      if (!snapshot.settings.sectionTimed) {
        throw fail(
          HttpStatus.CONFLICT,
          'NOT_SECTION_TIMED',
          'This exam doesn’t have timed sections.',
        );
      }
      const synced = await this.sync(
        tx,
        s,
        now,
        answers,
        { requireOpen: true },
        events,
      );
      if (synced.status !== 'in_progress') return synced;

      const next = advanceSection(
        { ...synced, lastSyncedAt: now },
        this.clockConfig(snapshot),
      );
      // Finishing the last section finishes the exam.
      if (next.expired)
        return this.finalize(
          tx,
          s,
          now,
          'manual',
          events,
          synced.rejected,
          synced,
        );
      await tx.examSession.update({
        where: { id: s.id },
        data: {
          timeRemainingMs: next.timeRemainingMs,
          sectionRemainingMs: next.sectionRemainingMs,
          currentSectionIndex: next.currentSectionIndex,
        },
      });
      events.push(
        await this.record(tx, s, 'section_advanced', now, {
          to: next.currentSectionIndex,
          reason: 'candidate',
        }),
      );
      return {
        ...synced,
        timeRemainingMs: next.timeRemainingMs,
        sectionRemainingMs: next.sectionRemainingMs,
        currentSectionIndex: next.currentSectionIndex,
      };
    });
  }

  /**
   * Final save + submit. `auto` = the client's timer hit zero; it's only
   * honoured if the server clock agrees (to within the offline grace).
   */
  submit(user: AuthUser, id: string, dto: SubmitSessionDto) {
    return this.mutate(user, id, async (tx, s, now, events) => {
      const synced = await this.sync(
        tx,
        s,
        now,
        dto.answers,
        { requireOpen: true },
        events,
      );
      if (synced.status !== 'in_progress') return synced;
      if (dto.auto && synced.timeRemainingMs > this.graceMs) {
        // The client's timer ran out but the server's didn't (e.g. its clock
        // kept counting while offline on a pause-on-disconnect exam): don't
        // take the candidate's time. The response re-syncs their timer.
        return synced;
      }
      return this.finalize(
        tx,
        s,
        now,
        dto.auto ? 'time_expired' : 'manual',
        events,
        synced.rejected,
        synced,
      );
    });
  }

  /** "Run" a coding answer against the question's sample test cases only. */
  async run(user: AuthUser, id: string, dto: RunCodeDto) {
    const s = await this.findOwned(user, id);
    if (s.status !== 'in_progress') throw this.closed(s.submitReason);
    const item = await this.prisma.examSessionItem.findFirst({
      where: { id: dto.itemId, sessionId: id },
      include: { questionVersion: { select: { content: true } } },
    });
    if (!item)
      throw fail(HttpStatus.NOT_FOUND, 'ITEM_NOT_FOUND', 'Question not found.');
    const snapshot = s.snapshot as unknown as SessionSnapshot;
    const clock = tick(
      this.clockState(s),
      this.clockConfig(snapshot),
      new Date(),
    );
    if (
      snapshot.settings.sectionTimed &&
      item.sectionIndex !== clock.currentSectionIndex
    ) {
      throw fail(
        HttpStatus.CONFLICT,
        'SECTION_LOCKED',
        'This section is closed.',
      );
    }
    const content = item.questionVersion.content as unknown as QuestionContent;
    if (!('coding' in content)) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'NOT_CODING_QUESTION',
        'Only coding questions can be run.',
      );
    }
    const ok = await this.redis
      .set(`exam:run:${id}`, '1', 'EX', this.runCooldownSeconds, 'NX')
      .catch(() => 'OK'); // Redis down: don't block the candidate.
    if (ok === null) {
      throw fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'RUN_COOLDOWN',
        'Please wait a moment before running again.',
        { retryAfterSeconds: this.runCooldownSeconds },
      );
    }
    const samples = content.coding.testCases.filter((t) => t.isSample);
    const result = await this.runner.run({
      language: dto.language,
      source: dto.code,
      tests: samples,
      timeLimitMs: content.coding.timeLimitMs,
      memoryLimitMb: content.coding.memoryLimitMb,
    });
    return {
      status: result.status,
      message: result.message ?? null,
      results: result.results.map((r, i) => ({
        ...r,
        input: samples[i].input,
        expectedOutput: samples[i].expectedOutput,
      })),
    };
  }

  /** The candidate's attempts, newest first (also used by the catalog). */
  async listMine(user: AuthUser) {
    const rows = await this.prisma.examSession.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { startedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        examId: true,
        attemptNumber: true,
        status: true,
        submitReason: true,
        startedAt: true,
        submittedAt: true,
        totalMarks: true,
        snapshot: true,
        _count: { select: { items: true } },
      },
    });
    return rows.map(({ snapshot, _count, ...r }) => ({
      ...r,
      title: (snapshot as unknown as SessionSnapshot).settings.title,
      kind: (snapshot as unknown as SessionSnapshot).settings.kind,
      questionCount: _count.items,
    }));
  }

  // ── Expiry sweep ──

  /**
   * Closes attempts nobody will close: strict-clock sessions whose time ran
   * out while the candidate was away, and pause-on-disconnect sessions not
   * resumed within EXAM_ABANDON_AFTER_HOURS. Safe to run on every instance.
   */
  async sweep(now = new Date(), limit = 100): Promise<number> {
    const abandonBefore = new Date(now.getTime() - this.abandonAfterMs);
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM exam_sessions
      WHERE status = 'in_progress' AND deleted_at IS NULL AND (
        (
          last_synced_at + make_interval(secs => time_remaining_ms / 1000.0) <= ${now}
          AND (
            (snapshot->'settings'->>'pauseOnDisconnect')::boolean = false
            OR time_remaining_ms <= ${this.graceMs}
          )
        )
        OR (
          (snapshot->'settings'->>'pauseOnDisconnect')::boolean = true
          AND last_synced_at < ${abandonBefore}
        )
      )
      ORDER BY last_synced_at
      LIMIT ${limit}`;
    let closed = 0;
    for (const { id } of due) {
      const events: ExamSessionEvent[] = [];
      const didClose = await this.prisma.$transaction(async (tx) => {
        const s = await this.lock(tx, id);
        if (!s || s.status !== 'in_progress') return false;
        const snapshot = s.snapshot as unknown as SessionSnapshot;
        const t = tick(this.clockState(s), this.clockConfig(snapshot), now);
        const abandoned =
          snapshot.settings.pauseOnDisconnect && t.gapMs > this.abandonAfterMs;
        // Re-checked under the lock: the candidate may have come back.
        if (!t.expired && !abandoned) return false;
        await this.persistClock(tx, s, t);
        await this.finalize(
          tx,
          s,
          now,
          t.expired ? 'time_expired' : 'abandoned',
          events,
          [],
          t,
        );
        return true;
      });
      await this.lifecycle.emit(events);
      if (didClose) closed += 1;
    }
    return closed;
  }

  // ── internals ──

  /** Locks the caller's session, runs `fn`, then emits lifecycle events after commit. */
  private async mutate<T>(
    user: AuthUser,
    id: string,
    fn: (
      tx: Tx,
      s: SessionRow,
      now: Date,
      events: ExamSessionEvent[],
    ) => Promise<T>,
  ): Promise<T> {
    const events: ExamSessionEvent[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const s = await this.lock(tx, id);
      if (!s || s.userId !== user.id) throw this.notFound();
      return fn(tx, s, new Date(), events);
    });
    await this.lifecycle.emit(events);
    return result;
  }

  private async lock(tx: Tx, id: string): Promise<SessionRow | null> {
    await tx.$executeRaw`SELECT 1 FROM exam_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.examSession.findFirst({
      where: { id, deletedAt: null },
      select: sessionSelect,
    });
  }

  /**
   * Charges the clock, applies answers, and submits if time ran out. Answers
   * are checked against the section that was open *before* this charge, so
   * work typed just before a section/exam timed out still counts.
   */
  private async sync(
    tx: Tx,
    s: SessionRow,
    now: Date,
    answers: AnswerDto[],
    { requireOpen }: { requireOpen: boolean },
    events: ExamSessionEvent[],
  ): Promise<SyncResult> {
    if (s.status !== 'in_progress') {
      if (requireOpen) throw this.closed(s.submitReason);
      return this.resultOf(s, now, []);
    }
    const snapshot = s.snapshot as unknown as SessionSnapshot;
    const t = tick(this.clockState(s), this.clockConfig(snapshot), now);
    const rejected = await this.applyAnswers(tx, s, snapshot, answers, t, now);
    await this.persistClock(tx, s, t);

    if (t.wasOffline) {
      events.push(
        await this.record(tx, s, 'resumed', now, {
          gapMs: t.gapMs,
          chargedMs: t.chargedMs,
        }),
      );
    }
    if (t.sectionsAdvanced > 0) {
      events.push(
        await this.record(tx, s, 'section_advanced', now, {
          to: t.currentSectionIndex,
          reason: 'time',
        }),
      );
    }
    if (t.expired)
      return this.finalize(tx, s, now, 'time_expired', events, rejected, t);
    return {
      status: 'in_progress',
      submitReason: null,
      timeRemainingMs: t.timeRemainingMs,
      sectionRemainingMs: t.sectionRemainingMs,
      currentSectionIndex: t.currentSectionIndex,
      serverTime: now,
      rejected,
    };
  }

  private async applyAnswers(
    tx: Tx,
    s: SessionRow,
    snapshot: SessionSnapshot,
    answers: AnswerDto[],
    t: ClockTick,
    now: Date,
  ): Promise<RejectedAnswer[]> {
    if (!answers.length) return [];
    const rows = await tx.examSessionItem.findMany({
      where: { sessionId: s.id, id: { in: answers.map((a) => a.itemId) } },
      select: {
        id: true,
        sectionIndex: true,
        visitedAt: true,
        questionVersion: { select: { content: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rejected: RejectedAnswer[] = [];

    for (const a of answers) {
      const item = byId.get(a.itemId);
      if (!item) {
        rejected.push({
          itemId: a.itemId,
          code: 'ITEM_NOT_FOUND',
          message: 'Question not found in this attempt',
        });
        continue;
      }
      if (
        snapshot.settings.sectionTimed &&
        item.sectionIndex !== s.currentSectionIndex
      ) {
        rejected.push({
          itemId: a.itemId,
          code: 'SECTION_LOCKED',
          message: 'This section is closed',
        });
        continue;
      }
      const data: Prisma.ExamSessionItemUpdateInput = {};
      if (a.response !== undefined) {
        const r = normaliseResponse(
          a.response,
          item.questionVersion.content as unknown as QuestionContent,
        );
        if (!r.ok) {
          rejected.push({
            itemId: a.itemId,
            code: 'INVALID_ANSWER',
            message: r.error,
          });
          continue;
        }
        data.response = r.value === null ? Prisma.DbNull : r.value;
        data.answeredAt = r.value === null ? null : now;
      }
      if (a.markedForReview !== undefined)
        data.markedForReview = a.markedForReview;
      if (a.visited && !item.visitedAt) data.visitedAt = now;
      if (a.timeSpentMs) {
        // Can't have spent longer on a question than has passed since the last save.
        data.timeSpentMs = { increment: Math.min(a.timeSpentMs, t.gapMs) };
      }
      if (Object.keys(data).length)
        await tx.examSessionItem.update({ where: { id: item.id }, data });
    }
    return rejected;
  }

  private persistClock(tx: Tx, s: SessionRow, t: ClockState) {
    return tx.examSession.update({
      where: { id: s.id },
      data: {
        timeRemainingMs: t.timeRemainingMs,
        sectionRemainingMs: t.sectionRemainingMs,
        currentSectionIndex: t.currentSectionIndex,
        lastSyncedAt: t.lastSyncedAt,
      },
    });
  }

  private async finalize(
    tx: Tx,
    s: SessionRow,
    now: Date,
    reason: ExamSubmitReason,
    events: ExamSessionEvent[],
    rejected: RejectedAnswer[],
    clock: Pick<ClockState, 'timeRemainingMs' | 'currentSectionIndex'>,
  ): Promise<SyncResult> {
    const timeRemainingMs =
      reason === 'time_expired' ? 0 : clock.timeRemainingMs;
    await tx.examSession.update({
      where: { id: s.id },
      data: {
        status: 'submitted',
        submittedAt: now,
        submitReason: reason,
        timeRemainingMs,
      },
    });
    events.push(await this.record(tx, s, 'submitted', now, { reason }));
    return {
      status: 'submitted',
      submitReason: reason,
      timeRemainingMs,
      sectionRemainingMs: null,
      currentSectionIndex: clock.currentSectionIndex,
      serverTime: now,
      rejected,
    };
  }

  private async record(
    tx: Tx,
    s: Pick<SessionRow, 'id' | 'userId' | 'examId'>,
    type: ExamSessionEventType,
    at: Date,
    data?: Record<string, unknown>,
  ): Promise<ExamSessionEvent> {
    await tx.examSessionEvent.create({
      data: {
        sessionId: s.id,
        type,
        createdAt: at,
        data: data as Prisma.InputJsonValue | undefined,
      },
    });
    return {
      type,
      sessionId: s.id,
      userId: s.userId,
      examId: s.examId,
      at,
      data,
    };
  }

  private resultOf(
    s: SessionRow,
    now: Date,
    rejected: RejectedAnswer[],
  ): SyncResult {
    return {
      status: s.status,
      submitReason: s.submitReason,
      timeRemainingMs: s.timeRemainingMs,
      sectionRemainingMs: s.sectionRemainingMs,
      currentSectionIndex: s.currentSectionIndex,
      serverTime: now,
      rejected,
    };
  }

  private async findOwned(user: AuthUser, id: string): Promise<SessionRow> {
    const s = await this.prisma.examSession.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: sessionSelect,
    });
    if (!s) throw this.notFound();
    return s;
  }

  private clockState(s: SessionRow): ClockState {
    return {
      timeRemainingMs: s.timeRemainingMs,
      sectionRemainingMs: s.sectionRemainingMs,
      currentSectionIndex: s.currentSectionIndex,
      lastSyncedAt: s.lastSyncedAt,
    };
  }

  private clockConfig(snapshot: SessionSnapshot): ClockConfig {
    return {
      sectionDurationsMs: sectionDurationsMs(snapshot),
      pauseOnDisconnect: snapshot.settings.pauseOnDisconnect,
      offlineGraceMs: this.graceMs,
    };
  }

  private snapshotOf(exam: ExamWithSections): SessionSnapshot {
    return {
      settings: {
        title: exam.title,
        kind: exam.kind,
        durationMinutes: exam.durationMinutes,
        sectionTimed: exam.sectionTimed,
        pauseOnDisconnect: exam.pauseOnDisconnect,
        shuffleQuestions: exam.shuffleQuestions,
        shuffleOptions: exam.shuffleOptions,
        passPercent: exam.passPercent,
      },
      sections: exam.sections.map((s) => ({
        title: s.title,
        description: s.description,
        durationMinutes: s.durationMinutes,
        marksPerQuestion: s.marksPerQuestion,
        negativeMarkPercent: s.negativeMarkPercent,
        partialScoring: s.partialScoring,
        questionCount: s.items.length,
      })),
    };
  }

  /** Copies the exam's pinned questions into the attempt, shuffling if configured. */
  private itemRows(exam: ExamWithSections) {
    return exam.sections.flatMap((section, sectionIndex) => {
      const items = exam.shuffleQuestions
        ? shuffled(section.items)
        : section.items;
      return items.map((item, position) => {
        const version = item.questionVersion;
        if (!version) {
          // Publishing guarantees pinned versions; this is a data problem.
          throw fail(
            HttpStatus.CONFLICT,
            'EXAM_NOT_FOUND',
            'This exam is being updated. Please try again shortly.',
          );
        }
        const content = version.content as unknown as QuestionContent;
        const optionIds =
          'mcq' in content ? content.mcq.options.map((o) => o.id) : null;
        return {
          sectionIndex,
          position,
          questionId: item.questionId,
          questionVersionId: version.id,
          type: item.question.type,
          marks: itemMarks(section, item),
          negativeMarkPercent: section.negativeMarkPercent,
          partialScoring: section.partialScoring,
          optionOrder: optionIds
            ? exam.shuffleOptions
              ? shuffled(optionIds)
              : optionIds
            : Prisma.DbNull,
        };
      });
    });
  }

  private notFound() {
    return fail(
      HttpStatus.NOT_FOUND,
      'SESSION_NOT_FOUND',
      'Attempt not found.',
    );
  }

  private closed(reason: ExamSubmitReason | null) {
    return fail(
      HttpStatus.CONFLICT,
      'SESSION_CLOSED',
      reason === 'time_expired'
        ? 'Time is up — this attempt was submitted automatically.'
        : 'This attempt has already been submitted.',
      { submitReason: reason },
    );
  }
}
