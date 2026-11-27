import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation } from "react-router-dom";
import { playSfx } from "../platform/sound";
import { useSettings } from "../store/settings";
import { PET_HOLD_MS, PingBrain, type Reaction } from "./engine";
import PingCanvas, { OFFSET_X, OFFSET_Y } from "./PingCanvas";
import { freeSpot, type Box } from "./perch";
import { SW } from "./sprite";
import "./ping.css";

const SAY_MS = 2600;

function useDeviceReducedMotion(): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setOn(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return on;
}

/** Screen pixels per sprite pixel: smaller on phones. */
function useScale(): number {
  const query = "(max-width: 640px)";
  const [small, setSmall] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setSmall(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return small ? 1.5 : 2;
}

/** Sprite rows above his feet when hanging (where the bar goes). */
const FEET = 2;

/**
 * His spot: hanging from the top of the page in a free gap of the header row
 * (between the logo and the links), or, when the row is full, just below the
 * header on the right.
 */
function usePerch(perchRef: React.RefObject<HTMLDivElement>, size: number, active: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const header = perchRef.current?.parentElement;
    if (!active || !header) return;
    const measure = () => {
      const row = header.getBoundingClientRect();
      const items: Box[] = [];
      header.querySelectorAll(".brand, .nav-links > *").forEach((el) => items.push(el.getBoundingClientRect()));
      setLeft(freeSpot(row, items, { top: row.top, bottom: row.top + size }, size));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    header.querySelectorAll(".nav-links").forEach((el) => ro.observe(el));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [perchRef, size, active]);
  return left;
}

/**
 * Ping, live: hangs upside down from the header, idles on his own, reacts to
 * clicks, gets dizzy when poked fast and enjoys being petted (press and hold).
 */
export default function Ping() {
  const { pathname } = useLocation();
  const brain = useMemo(() => {
    const b = new PingBrain();
    b.hanging = true;
    return b;
  }, []);
  const reducedSetting = useSettings((s) => s.reducedMotion);
  const still = useDeviceReducedMotion() || reducedSetting;
  const scale = useScale();
  const [line, setLine] = useState<string | null>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const perchRef = useRef<HTMLDivElement>(null);
  const inGame = pathname.startsWith("/play/");
  const box = SW * scale;
  const spot = usePerch(perchRef, box, !inGame);
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

  // Games get a peeking Ping later; for now he stays out of them.
  if (inGame) return null;

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
    react(brain.click(performance.now(), still));
  };
  const onLeave = () => {
    window.clearTimeout(hold.current);
    hold.current = undefined;
    if (brain.petting) react(brain.stopPet());
  };

  const place: CSSProperties =
    spot === null
      ? { top: `calc(100% - ${FEET * scale}px)`, right: "clamp(12px, 14%, 200px)" }
      : { top: 0, left: spot };
  return (
    <div ref={perchRef} className="ping-perch" style={{ width: box, height: box, ...place }}>
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
            if (!e.repeat) react(brain.click(performance.now(), still));
          }
        }}
      >
        <PingCanvas
          brain={brain}
          scale={scale}
          still={still}
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
