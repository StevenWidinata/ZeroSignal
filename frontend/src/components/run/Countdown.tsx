import { useEffect, useRef, useState } from "react";
import { playSfx } from "../../platform/sound";

export const COUNTDOWN = ["3", "2", "1", "GO!"];

/**
 * 3-2-1-GO before a real-time round. Calls `onGo` once, as "GO!" ends.
 * Returns the label to show (null once the round runs).
 */
export function useCountdown(onGo: () => void): { label: string | null; done: boolean } {
  const [count, setCount] = useState(0);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;

  useEffect(() => {
    if (count >= COUNTDOWN.length) return;
    const last = count === COUNTDOWN.length - 1;
    playSfx(last ? "win" : "tick");
    const id = window.setTimeout(
      () => {
        if (last) onGoRef.current();
        setCount((c) => c + 1);
      },
      last ? 450 : 700,
    );
    return () => window.clearTimeout(id);
  }, [count]);

  const done = count >= COUNTDOWN.length;
  return { label: done ? null : COUNTDOWN[count], done };
}

interface OverlayProps {
  /** Countdown label, or null. */
  countdown: string | null;
  paused: boolean;
  onResume: () => void;
  /** Extra line under "Paused" (e.g. which key resumes). */
  hint?: string;
}

/** The countdown / paused layer drawn over a game board. */
export function RunOverlay({ countdown, paused, onResume, hint }: OverlayProps) {
  if (countdown !== null) {
    return (
      <div className="wam-overlay" aria-live="assertive">
        <span key={countdown} className="wam-count">
          {countdown}
        </span>
      </div>
    );
  }
  if (!paused) return null;
  return (
    <div className="wam-overlay">
      <div className="wam-paused">
        <strong>Paused</strong>
        {hint && <small>{hint}</small>}
        <button className="btn-green" onClick={onResume} autoFocus>
          ▶ Resume
        </button>
      </div>
    </div>
  );
}
