import { useCallback, useEffect, useState } from 'react';

/** Seconds-remaining countdown for "resend code" buttons. */
export function useCooldown(
  initialSeconds = 0,
): [remaining: number, start: (seconds: number) => void] {
  const [now, setNow] = useState(() => Date.now());
  const [until, setUntil] = useState(() => now + initialSeconds * 1000);

  useEffect(() => {
    if (until <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until, now]);

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setUntil(t + seconds * 1000);
  }, []);

  return [Math.max(0, Math.ceil((until - now) / 1000)), start];
}
