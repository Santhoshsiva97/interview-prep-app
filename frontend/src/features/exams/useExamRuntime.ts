import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import {
  examsApi,
  type AnswerPatch,
  type ItemResponse,
  type SessionItem,
  type SessionView,
  type SyncResult,
} from './api';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'offline';

/**
 * Exam runtime state (FRD §4.6). The server owns the clock and the answers:
 *
 * - Changes are queued locally as patches and sent by the autosave, which
 *   runs every `autosaveIntervalMs` even when nothing changed (the heartbeat
 *   keeps the server clock charging normally).
 * - Unsent patches are also mirrored to localStorage, so a crash or a closed
 *   tab while offline loses nothing: they're re-applied on the next load.
 * - The countdown runs locally between saves and is re-anchored to the
 *   server's remaining time on every response. At zero the attempt is
 *   auto-submitted (and the server enforces it regardless).
 */
export function useExamRuntime(sessionId: string) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [now, setNow] = useState(() => performance.now());

  // Server's remaining time and when we heard it (performance.now()).
  const [anchor, setAnchor] = useState({
    remainingMs: 0,
    sectionRemainingMs: 0,
    at: 0,
  });
  const pending = useRef(new Map<string, AnswerPatch>());
  const inFlight = useRef<Promise<void> | null>(null);
  const visit = useRef<{ itemId: string; since: number } | null>(null);
  const sessionRef = useRef<SessionView | null>(null);
  const finishing = useRef(false);
  const backupTimer = useRef<number | undefined>(undefined);
  const keys = useMemo(
    () => ({
      pending: `exam-session:${sessionId}:pending`,
      position: `exam-session:${sessionId}:position`,
    }),
    [sessionId],
  );

  const open = session?.status === 'in_progress';

  // ── server state ──

  const anchorClock = (r: {
    timeRemainingMs: number;
    sectionRemainingMs: number | null;
  }) => {
    const at = performance.now();
    setAnchor({
      remainingMs: r.timeRemainingMs,
      sectionRemainingMs: r.sectionRemainingMs ?? r.timeRemainingMs,
      at,
    });
    setNow(at);
  };

  const show = useCallback(
    (view: SessionView, restore: AnswerPatch[] = []) => {
      let next = view.items;
      if (view.status === 'in_progress') {
        for (const p of restore) {
          const item = next.find((i) => i.id === p.itemId);
          if (!item?.question) continue;
          queue(p);
          next = next.map((i) => (i.id === p.itemId ? applyPatch(i, p) : i));
        }
      }
      sessionRef.current = view;
      setSession(view);
      setItems(next);
      anchorClock(view);
      const accessible = next.filter((i) => i.question);
      const saved = readJson<string>(keys.position);
      setCurrentId((prev) => {
        const pick =
          [prev, saved].find((id) => accessible.some((i) => i.id === id)) ??
          accessible[0]?.id ??
          null;
        return pick;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys],
  );

  /** (Re)connects: charges the server clock and shows the attempt, replaying unsaved local work. */
  const reload = useCallback(
    () =>
      examsApi.resume(sessionId).then((view) => {
        show(view, readJson<AnswerPatch[]>(keys.pending) ?? []);
        if (view.status !== 'in_progress') clearBackup();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, show, keys],
  );

  // Initial load, retried with backoff: a flaky connection shouldn't strand
  // the candidate on an error screen. 4xx (e.g. not found) fails at once.
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const attempt = (n: number) =>
      examsApi
        .resume(sessionId)
        .then((view) => {
          if (!cancelled)
            show(view, readJson<AnswerPatch[]>(keys.pending) ?? []);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const retryable =
            err instanceof ApiError && (err.status === 0 || err.status >= 500);
          if (retryable && n < 4)
            timer = window.setTimeout(() => void attempt(n + 1), 500 * 2 ** n);
          else setLoadError(errorMessage(err));
        });
    void attempt(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionId, show, keys, loadAttempt]);

  const retryLoad = () => {
    setLoadError('');
    setLoadAttempt((n) => n + 1);
  };

  // ── local changes ──

  function queue(p: AnswerPatch) {
    const prev = pending.current.get(p.itemId);
    pending.current.set(p.itemId, prev ? mergePatch(prev, p) : p);
    setSaveState((s) => (s === 'offline' ? s : 'unsaved'));
    window.clearTimeout(backupTimer.current);
    backupTimer.current = window.setTimeout(writeBackup, 400);
  }

  function writeBackup() {
    // Time-on-question is best effort and not worth replaying.
    const patches = [...pending.current.values()]
      .map((p) => ({ ...p, timeSpentMs: undefined }))
      .filter(
        (p) =>
          p.response !== undefined ||
          p.markedForReview !== undefined ||
          p.visited,
      );
    try {
      if (patches.length)
        localStorage.setItem(keys.pending, JSON.stringify(patches));
      else localStorage.removeItem(keys.pending);
    } catch {
      // Storage full or blocked: the server copy is still the source of truth.
    }
  }

  function clearBackup() {
    try {
      localStorage.removeItem(keys.pending);
    } catch {
      // ignore
    }
  }

  const change = (itemId: string, p: Omit<AnswerPatch, 'itemId'>) => {
    if (!sessionRef.current || sessionRef.current.status !== 'in_progress')
      return;
    const patch = { itemId, ...p };
    queue(patch);
    setItems((xs) =>
      xs.map((i) => (i.id === itemId ? applyPatch(i, patch) : i)),
    );
  };

  const setResponse = (itemId: string, response: ItemResponse | null) =>
    change(itemId, { response });

  const setReview = (itemId: string, markedForReview: boolean) =>
    change(itemId, { markedForReview });

  /** Adds the time spent on the current question to its pending patch. */
  const flushTime = () => {
    const v = visit.current;
    if (!v) return;
    const t = performance.now();
    const ms = Math.round(t - v.since);
    if (ms > 0) queue({ itemId: v.itemId, timeSpentMs: ms });
    visit.current = { itemId: v.itemId, since: t };
  };

  // Track which question is on screen (for "visited" and time spent).
  useEffect(() => {
    if (!currentId || !open) return;
    flushTime();
    visit.current = { itemId: currentId, since: performance.now() };
    const item = items.find((i) => i.id === currentId);
    if (item && !item.visited) change(currentId, { visited: true });
    try {
      localStorage.setItem(keys.position, JSON.stringify(currentId));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, open]);

  // ── talking to the server ──

  /** Takes the queued patches; returns a function that puts them back on failure. */
  const takePending = () => {
    flushTime();
    const batch = [...pending.current.values()];
    pending.current = new Map();
    return {
      batch,
      restore: () => {
        const newer = pending.current;
        pending.current = new Map(batch.map((p) => [p.itemId, p]));
        for (const p of newer.values()) queue(p);
      },
    };
  };

  const afterSync = useCallback(
    async (r: SyncResult) => {
      anchorClock(r);
      const rejected = r.rejected.filter((x) => x.code !== 'SECTION_LOCKED');
      if (rejected.length)
        setNotice(`Some answers weren’t saved: ${rejected[0].message}.`);
      const current = sessionRef.current;
      if (r.status === 'submitted') {
        finishing.current = true;
        clearBackup();
        show(await examsApi.view(sessionId));
      } else if (
        current &&
        r.currentSectionIndex !== current.currentSectionIndex
      ) {
        setNotice('Time’s up for that section. The next section has started.');
        setCurrentId(null);
        await reload();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, show, reload],
  );

  const onClosed = useCallback(
    async (err: unknown) => {
      if (err instanceof ApiError && err.code === 'SESSION_CLOSED') {
        finishing.current = true;
        pending.current = new Map();
        clearBackup();
        show(await examsApi.view(sessionId));
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, show],
  );

  const save = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (sessionRef.current?.status !== 'in_progress') return Promise.resolve();
    const { batch, restore } = takePending();
    setSaveState('saving');
    const run = examsApi
      .save(sessionId, batch)
      .then(async (r) => {
        setLastSavedAt(new Date());
        setSaveState(pending.current.size ? 'unsaved' : 'saved');
        if (!pending.current.size) clearBackup();
        await afterSync(r);
      })
      .catch(async (err: unknown) => {
        if (await onClosed(err)) return;
        restore();
        // Network down or server unreachable: keep the answers and retry.
        setSaveState('offline');
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, afterSync, onClosed]);

  const submit = useCallback(
    async (auto: boolean) => {
      if (finishing.current && !auto) return;
      finishing.current = true;
      setSubmitting(true);
      setSubmitError('');
      await inFlight.current;
      const { batch, restore } = takePending();
      try {
        const r = await examsApi.submit(sessionId, batch, auto);
        // The server's clock still has time (auto-submit only): carry on.
        if (r.status === 'in_progress') finishing.current = false;
        await afterSync(r);
      } catch (err) {
        if (await onClosed(err)) return;
        restore();
        finishing.current = false;
        setSubmitError(
          `${errorMessage(err)} Your answers are safe on this device; we’ll keep trying.`,
        );
      } finally {
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, afterSync, onClosed],
  );

  const nextSection = useCallback(async () => {
    setSubmitting(true);
    setSubmitError('');
    await inFlight.current;
    const { batch, restore } = takePending();
    try {
      const r = await examsApi.nextSection(sessionId, batch);
      anchorClock(r);
      if (r.status === 'submitted') {
        finishing.current = true;
        clearBackup();
        show(await examsApi.view(sessionId));
      } else {
        setCurrentId(null);
        await reload();
      }
    } catch (err) {
      if (await onClosed(err)) return;
      restore();
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, show, reload, onClosed]);

  // Autosave heartbeat.
  const interval = session?.autosaveIntervalMs;
  useEffect(() => {
    if (!open || !interval) return;
    const id = window.setInterval(() => void save(), interval);
    const online = () => void save();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', online);
    };
  }, [open, interval, save]);

  // Leaving the page: best-effort final save that outlives the page.
  useEffect(() => {
    if (!open) return;
    const flush = () => {
      if (document.visibilityState === 'visible') return;
      flushTime();
      writeBackup();
      const answers = [...pending.current.values()];
      if (!answers.length) return;
      void apiFetch(`/exam-sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ answers }),
        keepalive: true,
      })
        .then(() => {
          pending.current = new Map();
          clearBackup();
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  // Local countdown.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [open]);

  const elapsed = Math.max(0, now - anchor.at);
  const remainingMs = Math.max(0, anchor.remainingMs - elapsed);
  const sectionRemainingMs = session?.exam.sectionTimed
    ? Math.max(0, anchor.sectionRemainingMs - elapsed)
    : null;

  // Time's up: auto-submit, or sync so the server starts the next section.
  // The local clock can run a little ahead of the server's, so keep poking.
  const lastPoke = useRef(0);
  const loaded = anchor.at !== 0;
  useEffect(() => {
    if (!open || !loaded) return;
    if (remainingMs <= 0) {
      if (!finishing.current) void submit(true);
    } else if (
      sectionRemainingMs !== null &&
      sectionRemainingMs <= 0 &&
      now - lastPoke.current > 2000
    ) {
      lastPoke.current = now;
      void save();
    }
  }, [open, loaded, now, remainingMs, sectionRemainingMs, submit, save]);

  // Retry a failed auto-submit.
  useEffect(() => {
    if (!submitError || remainingMs > 0) return;
    const id = window.setTimeout(() => void submit(true), 5000);
    return () => window.clearTimeout(id);
  }, [submitError, remainingMs, submit]);

  return {
    session,
    items,
    loadError,
    retryLoad,
    current: items.find((i) => i.id === currentId) ?? null,
    goTo: setCurrentId,
    setResponse,
    setReview,
    remainingMs,
    sectionRemainingMs,
    saveState,
    lastSavedAt,
    saveNow: save,
    submit,
    nextSection,
    submitting,
    submitError,
    notice,
    dismissNotice: () => setNotice(''),
  };
}

function mergePatch(older: AnswerPatch, newer: AnswerPatch): AnswerPatch {
  const time = (older.timeSpentMs ?? 0) + (newer.timeSpentMs ?? 0);
  return {
    ...older,
    ...newer,
    ...(time ? { timeSpentMs: time } : {}),
  };
}

function applyPatch(item: SessionItem, p: AnswerPatch): SessionItem {
  return {
    ...item,
    ...(p.response !== undefined && {
      response: p.response,
      answered: p.response !== null,
    }),
    ...(p.markedForReview !== undefined && {
      markedForReview: p.markedForReview,
    }),
    ...(p.visited && { visited: true }),
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
