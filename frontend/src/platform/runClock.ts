import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Game clock for real-time rounds (Whack-a-Mole, Snake Signal…).
 *
 * Game time follows real time (times `rate`, e.g. 0.5 during a slow-mo
 * power-up), is frozen while paused, and pauses itself when the tab is
 * hidden. Pausing only makes a round take longer in real time, which the
 * servers allow (they only reject rounds that finish too fast).
 */
export interface RunClock {
  /** Current game time in ms (rounded). Advances the clock. */
  now: () => number;
  /** Start counting (after the countdown). */
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** True once `start` ran. */
  started: boolean;
  paused: boolean;
  /** Ref mirror of `paused`, for loops that must not wait for a render. */
  pausedRef: React.MutableRefObject<boolean>;
}

/**
 * @param rate  speed of game time at the given game time (default 1).
 * @param stopped  when true (round over), pausing is ignored.
 */
export function useRunClock(rate?: (gameMs: number) => number, stopped?: () => boolean): RunClock {
  const clock = useRef<{ game: number; real: number | null }>({ game: 0, real: null });
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const stoppedRef = useRef(stopped);
  stoppedRef.current = stopped;

  const now = useCallback(() => {
    const c = clock.current;
    if (c.real === null || pausedRef.current) return Math.round(c.game);
    const r = performance.now();
    c.game += (r - c.real) * (rateRef.current?.(c.game) ?? 1);
    c.real = r;
    return Math.round(c.game);
  }, []);

  const start = useCallback(() => {
    if (clock.current.real !== null) return;
    clock.current.real = performance.now();
    setStarted(true);
  }, []);

  const pause = useCallback(() => {
    if (clock.current.real === null || pausedRef.current || stoppedRef.current?.()) return;
    now();
    pausedRef.current = true;
    setPaused(true);
  }, [now]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    clock.current.real = performance.now();
    pausedRef.current = false;
    setPaused(false);
  }, []);

  useEffect(() => {
    const onVis = () => document.hidden && pause();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pause]);

  return { now, start, pause, resume, started, paused, pausedRef };
}
