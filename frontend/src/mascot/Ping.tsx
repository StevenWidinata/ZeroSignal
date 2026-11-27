import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation } from "react-router-dom";
import { playSfx } from "../platform/sound";
import { useSettings } from "../store/settings";
import { PET_HOLD_MS, PingBrain, type Reaction } from "./engine";
import PingCanvas, { OFFSET_X, OFFSET_Y } from "./PingCanvas";
import { SW } from "./sprite";
import "./ping.css";

const SAY_MS = 2600;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setOn(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return on;
}

/**
 * Ping, the site's logo and mascot: hangs upside down beside the ZERO SIGNAL
 * wordmark, idles on his own, does a trick when clicked, gets dizzy when
 * poked fast and enjoys being petted (press and hold). In a game he keeps
 * quiet: no idles, just blinks, though he still answers clicks.
 */
export default function Ping() {
  const { pathname } = useLocation();
  const brain = useMemo(() => {
    const b = new PingBrain();
    b.hanging = true;
    return b;
  }, []);
  const reducedSetting = useSettings((s) => s.reducedMotion);
  const reducedDevice = useMedia("(prefers-reduced-motion: reduce)");
  const phone = useMedia("(max-width: 560px)");
  const reduced = reducedSetting || reducedDevice;
  const scale = phone ? 1.25 : 1.5;
  const quiet = reduced || pathname.startsWith("/play/");
  const [line, setLine] = useState<string | null>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const hold = useRef<number | undefined>(undefined);
  const sayTimer = useRef<number | undefined>(undefined);

  const react = (r: Reaction) => {
    if (r.sfx) playSfx(r.sfx);
    if (!r.line) return;
    setLine(r.line);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setLine(null), SAY_MS);
  };

  useEffect(
    () => () => {
      window.clearTimeout(hold.current);
      window.clearTimeout(sayTimer.current);
    },
    [],
  );

  // His eyes follow the pointer across the page.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const dx = e.clientX - (box.left + box.width / 2);
      brain.hoverLook = Math.abs(dx) < 60 ? 0 : dx < 0 ? -1 : 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [brain]);

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    window.clearTimeout(hold.current);
    hold.current = window.setTimeout(() => {
      hold.current = undefined;
      brain.startPet();
      playSfx("batChirp");
    }, PET_HOLD_MS);
  };
  const onUp = () => {
    if (brain.petting) return react(brain.stopPet());
    if (hold.current === undefined) return;
    window.clearTimeout(hold.current);
    hold.current = undefined;
    react(brain.click(performance.now(), reduced));
  };
  const onLeave = () => {
    window.clearTimeout(hold.current);
    hold.current = undefined;
    if (brain.petting) react(brain.stopPet());
  };

  const box = SW * scale;
  return (
    <div className="ping-logo" style={{ width: box, height: box }}>
      <button
        ref={boxRef}
        type="button"
        className="ping-hit"
        aria-label="Ping the bat. Click to play, press and hold to pet."
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
        onPointerCancel={onLeave}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!e.repeat) react(brain.click(performance.now(), reduced));
          }
        }}
      >
        <PingCanvas
          brain={brain}
          scale={scale}
          still={quiet}
          className="ping-canvas"
          style={{ left: -OFFSET_X * scale, top: -OFFSET_Y * scale }}
        />
      </button>
      <div className={`ping-bubble${line ? " show" : ""}`} role="status" aria-live="polite">
        {line}
      </div>
    </div>
  );
}
