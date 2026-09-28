/**
 * Server-authoritative exam clock (FRD §4.6). A session stores the time left
 * as of its last server contact (`lastSyncedAt`). Every contact (start,
 * resume, autosave, submit) calls `tick()` to charge the time elapsed since
 * then and persists the result, so a dropped connection resumes from the
 * saved remaining time.
 *
 * Pure functions: no I/O, `now` is passed in.
 */

export interface ClockState {
  /** Total time left. In section-timed exams: current section + all later sections. */
  timeRemainingMs: number;
  /** Section-timed exams only: time left in the current section. */
  sectionRemainingMs: number | null;
  currentSectionIndex: number;
  lastSyncedAt: Date;
}

export interface ClockConfig {
  /** Per-section limits for section-timed exams; null = one clock for the whole exam. */
  sectionDurationsMs: number[] | null;
  /**
   * true: a gap between contacts longer than `offlineGraceMs` is treated as a
   * disconnection and only the grace is charged (the clock "pauses" while
   * offline). false: wall-clock time is always charged.
   */
  pauseOnDisconnect: boolean;
  offlineGraceMs: number;
}

export interface ClockTick extends ClockState {
  /** Time since the last contact. */
  gapMs: number;
  /** Time actually taken off the clock. */
  chargedMs: number;
  /** The gap was longer than the grace (the client was away). */
  wasOffline: boolean;
  /** Sections that ran out during this tick (section-timed only). */
  sectionsAdvanced: number;
  expired: boolean;
}

export function initialClock(
  totalMs: number,
  cfg: Pick<ClockConfig, 'sectionDurationsMs'>,
  now: Date,
): ClockState {
  const d = cfg.sectionDurationsMs;
  return {
    timeRemainingMs: d ? sum(d) : totalMs,
    sectionRemainingMs: d ? d[0] : null,
    currentSectionIndex: 0,
    lastSyncedAt: now,
  };
}

/** Charges the time since `lastSyncedAt` and moves `lastSyncedAt` to `now`. */
export function tick(
  state: ClockState,
  cfg: ClockConfig,
  now: Date,
): ClockTick {
  const gapMs = Math.max(0, now.getTime() - state.lastSyncedAt.getTime());
  const wasOffline = gapMs > cfg.offlineGraceMs;
  const chargedMs =
    cfg.pauseOnDisconnect && wasOffline ? cfg.offlineGraceMs : gapMs;
  return {
    ...charge(state, cfg, chargedMs),
    lastSyncedAt: now,
    gapMs,
    chargedMs,
    wasOffline,
  };
}

/**
 * Candidate finished the current section early: its leftover time is
 * forfeited and the next section starts. On the last section this expires
 * the clock (the caller submits).
 */
export function advanceSection(
  state: ClockState,
  cfg: Pick<ClockConfig, 'sectionDurationsMs'>,
): ClockState & { expired: boolean } {
  const d = cfg.sectionDurationsMs;
  if (!d) throw new Error('advanceSection needs a section-timed exam');
  const next = state.currentSectionIndex + 1;
  if (next >= d.length) {
    return {
      ...state,
      timeRemainingMs: 0,
      sectionRemainingMs: 0,
      expired: true,
    };
  }
  return {
    ...state,
    currentSectionIndex: next,
    sectionRemainingMs: d[next],
    timeRemainingMs: sum(d.slice(next)),
    expired: false,
  };
}

function charge(
  state: ClockState,
  cfg: ClockConfig,
  ms: number,
): Omit<ClockTick, 'lastSyncedAt' | 'gapMs' | 'chargedMs' | 'wasOffline'> {
  const d = cfg.sectionDurationsMs;
  if (!d) {
    const timeRemainingMs = Math.max(0, state.timeRemainingMs - ms);
    return {
      timeRemainingMs,
      sectionRemainingMs: null,
      currentSectionIndex: state.currentSectionIndex,
      sectionsAdvanced: 0,
      expired: timeRemainingMs === 0,
    };
  }

  // Section-timed: time spills over into the following sections.
  let index = state.currentSectionIndex;
  let section = state.sectionRemainingMs ?? d[index];
  let left = ms;
  let sectionsAdvanced = 0;
  while (left >= section && index < d.length - 1) {
    left -= section;
    index += 1;
    section = d[index];
    sectionsAdvanced += 1;
  }
  section = Math.max(0, section - left);
  const timeRemainingMs = section + sum(d.slice(index + 1));
  return {
    timeRemainingMs,
    sectionRemainingMs: section,
    currentSectionIndex: index,
    sectionsAdvanced,
    expired: timeRemainingMs === 0,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
