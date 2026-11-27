import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { isTyping } from "../platform/display";
import { playSfx } from "../platform/sound";
import { isMember, useAuth } from "../store/auth";
import { readyCount, useQuests } from "../store/quests";
import { useSettings } from "../store/settings";
import { pingBus } from "./bus";
import { PET_HOLD_MS, PingBrain, type Reaction } from "./engine";
import { ECHO_LINES, NUDGES, REACTIONS, SONAR_LINES, tipsFor, type NudgeKind } from "./lines";
import { isMoping, moodNow, petted, touched } from "./mood";
import { nudgesAllowed, pickNudge, relevantHere } from "./nudge";
import { FLAP_CHEER_EVERY, echoKey, isNight } from "./secrets";
import PingCanvas, { OFFSET_X, OFFSET_Y } from "./PingCanvas";
import { SW } from "./sprite";
import "./ping.css";

const SAY_MS = 2600;
/** Pointer travel (px) that turns a press into picking him up. */
const DRAG_SLOP = { mouse: 6, touch: 10 } as const;
const HOME_LINES = ["Home sweet bar.", "Back on my bar.", "Nice view up there."];
/** A nudge comes this long after a page opens (if one applies). */
const NUDGE_DELAY_MS = 4000;
const NUDGE_KEY = "zerosignal_ping_nudges";
/** Prize and Daily status are fetched at most this often. */
const NUDGE_CACHE_MS = 5 * 60 * 1000;

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function readNudges(): Partial<Record<NudgeKind, number>> {
  try {
    const v = JSON.parse(localStorage.getItem(NUDGE_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function markNudge(k: NudgeKind) {
  try {
    localStorage.setItem(NUDGE_KEY, JSON.stringify({ ...readNudges(), [k]: Date.now() }));
  } catch {
    /* storage may be blocked */
  }
}

let nudgeCache: { at: number; who: string; prize: boolean; daily: boolean } | null = null;
/** Whether a weekly prize waits to be claimed and a Daily is still unplayed (cached briefly). */
async function openThings(who: string, member: boolean): Promise<{ prize: boolean; daily: boolean }> {
  if (nudgeCache && nudgeCache.who === who && Date.now() - nudgeCache.at < NUDGE_CACHE_MS) return nudgeCache;
  const [prize, daily] = await Promise.all([
    member ? api.weeklyPrizes().then((v) => v.prizes.some((p) => !p.claimed)).catch(() => false) : Promise.resolve(false),
    api.dailies().then((v) => v.some((d) => d.status === "new")).catch(() => false),
  ]);
  nudgeCache = { at: Date.now(), who, prize, daily };
  return nudgeCache;
}

function prefersReduced(): boolean {
  return useSettings.getState().reducedMotion || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

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

interface Press {
  id: number;
  x: number;
  y: number;
  touch: boolean;
  /** Pet timer still pending. */
  hold?: number;
  petSince?: number;
  dragging: boolean;
}

/**
 * Ping, the site's logo and mascot: hangs upside down beside the ZERO SIGNAL
 * wordmark, idles on his own, does a trick when clicked, gets dizzy when
 * poked fast, enjoys being petted (press and hold) and can be picked up and
 * carried around; let go and he flaps back to his bar. In a game he keeps
 * quiet (no idles). With "Lively Ping" off he just hangs there.
 */
export default function Ping() {
  const { pathname } = useLocation();
  const brain = useMemo(() => {
    const b = new PingBrain();
    b.hanging = true;
    return b;
  }, []);
  const lively = useSettings((s) => s.pingLively);
  const saved = useSettings((s) => s.ping);
  const update = useSettings((s) => s.update);
  const reducedSetting = useSettings((s) => s.reducedMotion);
  const reducedDevice = useMedia("(prefers-reduced-motion: reduce)");
  const phone = useMedia("(max-width: 560px)");
  const reduced = reducedSetting || reducedDevice;
  const scale = phone ? 1.25 : 1.5;
  const quiet = !lively || reduced || pathname.startsWith("/play/");
  const [line, setLine] = useState<string | null>(null);
  const [floating, setFloating] = useState(false);
  const user = useAuth((s) => s.user);
  const logoRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const press = useRef<Press | null>(null);
  const flight = useRef(0);
  const sayTimer = useRef<number | undefined>(undefined);

  // Mood: mope when it's low (re-checked every minute; it only drops every 8 hours).
  useEffect(() => {
    const check = () => {
      brain.moping = isMoping(moodNow(useSettings.getState().ping, Date.now()));
    };
    check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
  }, [brain, saved]);

  /** Show a line. When the logo has scrolled out of view, the bubble floats at the top of the screen instead. */
  const say = (text?: string) => {
    if (!text) return;
    const r = logoRef.current?.getBoundingClientRect();
    setFloating(!!r && r.bottom < 8);
    setLine(text);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setLine(null), SAY_MS);
  };
  const react = (r: Reaction) => {
    if (r.sfx) playSfx(r.sfx);
    say(r.line);
  };
  const noticed = () => {
    const next = touched(useSettings.getState().ping, Date.now());
    if (next) update({ ping: next });
  };

  useEffect(
    () => () => {
      window.clearTimeout(press.current?.hold);
      window.clearTimeout(sayTimer.current);
      cancelAnimationFrame(flight.current);
    },
    [],
  );

  // Page tips for whatever page he's on.
  useEffect(() => {
    brain.tips = tipsFor(pathname);
  }, [brain, pathname]);

  // Night owl: from midnight to 5 am he wears his nightcap.
  useEffect(() => {
    const check = () => {
      brain.night = isNight(new Date());
    };
    check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
  }, [brain]);

  // Echo chamber: type "ping" anywhere (not in a text field) and he answers.
  useEffect(() => {
    let buf = "";
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const r = echoKey(buf, e.key);
      buf = r.buf;
      if (!r.hit || !useSettings.getState().pingLively || brain.carried) return;
      if (!prefersReduced()) brain.play("echo");
      playSfx("batPong");
      say(pick(ECHO_LINES));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain]);

  // Games tell him how it went (and Sonar and Signal Flap let him join in).
  useEffect(
    () =>
      pingBus.on((e) => {
        if (!useSettings.getState().pingLively || brain.carried) return;
        if (e.type === "sonar-ping") {
          if (!prefersReduced() && !brain.petting) brain.play("ping");
          if (Math.random() < 0.35) say(pick(SONAR_LINES));
          return;
        }
        if (e.type === "flap-far") {
          if (e.gaps % FLAP_CHEER_EVERY !== 0) return;
          if (!prefersReduced() && !brain.petting) brain.play("flap");
          say(`${e.gaps} gaps. Keep flapping.`);
          return;
        }
        if (!prefersReduced() && !brain.carried) {
          if (e.kind === "best") brain.play("echo");
          else if (e.kind === "cheer") brain.play(Math.random() < 0.5 ? "flap" : "flip");
        }
        playSfx(e.kind === "best" ? "batPong" : e.kind === "cheer" ? "batFlap" : "batChirp");
        say(pick(REACTIONS[e.kind]));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brain],
  );

  // At most one nudge per page visit: a prize to claim, quests ready, or today's Daily.
  const who = user?.username ?? null;
  useEffect(() => {
    const u = useAuth.getState().user;
    if (!lively || !u || !nudgesAllowed(pathname)) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const things = await openThings(u.username, isMember(u));
      if (cancelled || brain.carried || brain.petting) return;
      const open = { ...things, quests: isMember(u) && readyCount(useQuests.getState().view) > 0 };
      const k = pickNudge(open, readNudges(), Date.now());
      if (!k || !relevantHere(k, pathname)) return;
      markNudge(k);
      playSfx("batChirp");
      say(NUDGES[k]);
    }, NUDGE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, lively, who, brain]);

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

  // Turned still: stop whatever he was doing.
  useEffect(() => {
    if (lively) return;
    brain.stopPet();
    brain.pose = null;
    setLine(null);
  }, [lively, brain]);

  /* ---------- carrying him around ---------- */

  const moveTo = (dx: number, dy: number) => {
    const el = logoRef.current;
    if (el) el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
  };

  const flyHome = (fromX: number, fromY: number) => {
    const dist = Math.hypot(fromX, fromY);
    const ms = Math.max(350, Math.min(1100, dist * 1.3));
    const start = performance.now();
    playSfx("batFlap");
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - k) ** 3;
      // A small arc, like flying rather than sliding.
      const lift = Math.sin(k * Math.PI) * Math.min(40, dist * 0.15);
      moveTo(fromX * (1 - e), fromY * (1 - e) - lift);
      if (k < 1) flight.current = requestAnimationFrame(step);
      else {
        moveTo(0, 0);
        logoRef.current?.classList.remove("carried");
        brain.carry(false);
        if (Math.random() < 0.5) say(HOME_LINES[Math.floor(Math.random() * HOME_LINES.length)]);
      }
    };
    flight.current = requestAnimationFrame(step);
  };

  /* ---------- pointer ---------- */

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || brain.carried) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p: Press = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", dragging: false };
    p.hold = window.setTimeout(() => {
      p.hold = undefined;
      if (p.dragging) return;
      p.petSince = performance.now();
      brain.startPet();
      playSfx("batChirp");
    }, PET_HOLD_MS);
    press.current = p;
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.petSince !== undefined) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_SLOP[p.touch ? "touch" : "mouse"]) return;
      p.dragging = true;
      window.clearTimeout(p.hold);
      p.hold = undefined;
      cancelAnimationFrame(flight.current);
      brain.carry(true);
      logoRef.current?.classList.add("carried");
      playSfx("batChirp");
      setLine(null);
    }
    moveTo(dx, dy);
  };

  const finish = (cancelled: boolean) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.hold);
    if (p.dragging) {
      const t = logoRef.current?.style.transform.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0];
      flyHome(t[0] ?? 0, t[1] ?? 0);
      noticed();
      return;
    }
    if (p.petSince !== undefined) {
      const seconds = (performance.now() - p.petSince) / 1000;
      update({ ping: petted(useSettings.getState().ping, Date.now(), seconds) });
      brain.moping = false;
      react(brain.stopPet());
      return;
    }
    if (cancelled || p.hold === undefined) return;
    react(brain.click(performance.now(), reduced));
    noticed();
  };

  const box = SW * scale;
  const canvas = (
    <PingCanvas
      brain={brain}
      scale={scale}
      still={quiet}
      className="ping-canvas"
      style={{ left: -OFFSET_X * scale, top: -OFFSET_Y * scale }}
    />
  );

  return (
    <div ref={logoRef} className="ping-logo" style={{ width: box, height: box }}>
      {lively ? (
        <button
          ref={boxRef}
          type="button"
          className="ping-hit"
          aria-label="Ping the bat. Click to play, press and hold to pet, drag to carry him."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => finish(false)}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => press.current && finish(true)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!e.repeat) {
                react(brain.click(performance.now(), reduced));
                noticed();
              }
            }
          }}
        >
          {canvas}
        </button>
      ) : (
        <div className="ping-still" role="img" aria-label="Ping the bat">
          {canvas}
        </div>
      )}
      <div className={`ping-bubble${line ? " show" : ""}${floating ? " float" : ""}`} role="status" aria-live="polite">
        {line && floating && <img className="ping-bubble-face" src="/favicon.svg" alt="" width={20} height={19} />}
        {line}
      </div>
    </div>
  );
}
