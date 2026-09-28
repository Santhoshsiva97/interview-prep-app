import {
  advanceSection,
  initialClock,
  tick,
  type ClockConfig,
} from './exam-clock.js';

const MIN = 60_000;
const t0 = new Date('2026-09-28T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const GRACE = 45_000;

const single = (pauseOnDisconnect: boolean): ClockConfig => ({
  sectionDurationsMs: null,
  pauseOnDisconnect,
  offlineGraceMs: GRACE,
});
const sections = (pauseOnDisconnect: boolean): ClockConfig => ({
  sectionDurationsMs: [10 * MIN, 20 * MIN, 5 * MIN],
  pauseOnDisconnect,
  offlineGraceMs: GRACE,
});

describe('exam clock', () => {
  it('starts with the full time (sum of sections when section-timed)', () => {
    expect(initialClock(30 * MIN, single(true), t0)).toEqual({
      timeRemainingMs: 30 * MIN,
      sectionRemainingMs: null,
      currentSectionIndex: 0,
      lastSyncedAt: t0,
    });
    expect(initialClock(999, sections(true), t0)).toMatchObject({
      timeRemainingMs: 35 * MIN,
      sectionRemainingMs: 10 * MIN,
    });
  });

  it('charges the full gap while the client keeps saving', () => {
    const s = initialClock(30 * MIN, single(true), t0);
    const t = tick(s, single(true), at(15_000));
    expect(t).toMatchObject({
      timeRemainingMs: 30 * MIN - 15_000,
      chargedMs: 15_000,
      wasOffline: false,
      expired: false,
      lastSyncedAt: at(15_000),
    });
  });

  it('pause-on-disconnect: a long gap only costs the grace (resume keeps the saved time)', () => {
    const s = initialClock(30 * MIN, single(true), t0);
    const t = tick(s, single(true), at(10 * MIN));
    expect(t).toMatchObject({
      gapMs: 10 * MIN,
      chargedMs: GRACE,
      wasOffline: true,
      timeRemainingMs: 30 * MIN - GRACE,
    });
  });

  it('strict clock: the whole gap is charged and the attempt expires', () => {
    const s = initialClock(30 * MIN, single(false), t0);
    expect(tick(s, single(false), at(10 * MIN)).timeRemainingMs).toBe(20 * MIN);
    const late = tick(s, single(false), at(31 * MIN));
    expect(late).toMatchObject({ timeRemainingMs: 0, expired: true });
  });

  it('never charges negative time (client clock skew)', () => {
    const s = initialClock(30 * MIN, single(true), t0);
    expect(tick(s, single(true), at(-5000))).toMatchObject({
      chargedMs: 0,
      timeRemainingMs: 30 * MIN,
    });
  });

  it('section-timed: time spills into later sections and advances them', () => {
    const cfg = sections(false);
    const s = initialClock(0, cfg, t0);
    // 10 min section 1 + 5 min into section 2.
    const t = tick(s, cfg, at(15 * MIN));
    expect(t).toMatchObject({
      currentSectionIndex: 1,
      sectionRemainingMs: 15 * MIN,
      timeRemainingMs: 20 * MIN,
      sectionsAdvanced: 1,
      expired: false,
    });
    // Exactly at a boundary moves on to the next section.
    expect(tick(s, cfg, at(10 * MIN))).toMatchObject({
      currentSectionIndex: 1,
      sectionRemainingMs: 20 * MIN,
    });
    // Past the end of the last section.
    expect(tick(s, cfg, at(40 * MIN))).toMatchObject({
      currentSectionIndex: 2,
      sectionRemainingMs: 0,
      timeRemainingMs: 0,
      expired: true,
      sectionsAdvanced: 2,
    });
  });

  it('finishing a section early forfeits its leftover time; the last one expires the clock', () => {
    const cfg = sections(true);
    const s = tick(initialClock(0, cfg, t0), cfg, at(2 * MIN));
    const next = advanceSection(s, cfg);
    expect(next).toMatchObject({
      currentSectionIndex: 1,
      sectionRemainingMs: 20 * MIN,
      timeRemainingMs: 25 * MIN,
      expired: false,
    });
    const last = advanceSection(advanceSection(next, cfg), cfg);
    expect(last).toMatchObject({ expired: true, timeRemainingMs: 0 });
    expect(() => advanceSection(s, single(true))).toThrow();
  });
});
