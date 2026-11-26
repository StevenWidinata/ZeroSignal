import { useCallback, useEffect, useRef, useState } from "react";
import { RunOverlay, useCountdown } from "../../components/run/Countdown";
import { Bursts } from "../../platform/burst";
import { keyLabel, keysFor } from "../../platform/keymap";
import { useGuardWhile } from "../../platform/leaveGuard";
import { useRunClock } from "../../platform/runClock";
import { playSfx } from "../../platform/sound";
import { useSettings, vibrate } from "../../store/settings";
import { rules, type Game, type GameEvent } from "./engine";
import { FlapControl, GAME_ID, actionForKey } from "./input";
import { findDrone, findSky, findTrail } from "./items";
import { END_TEXT } from "./modes";
import { boardHeight, drawFrame, type Look } from "./render";

interface Pop {
  id: number;
  /** Board position in % (0..100). */
  x: number;
  y: number;
  text: string;
  tone: "good" | "gold" | "bad";
}

export interface RoundLook {
  drone: string;
  trail: string;
  sky: string;
}

interface Props {
  game: Game;
  look: RoundLook;
  daily: boolean;
  /** Your best before this run (0 = none), to cheer when you pass it. */
  best: number;
  /** Run over: the ticks you flapped on, and the quit tick if you quit. */
  onDone: (flaps: number[], quitAt: number | null) => void;
}

const TICK_MS = 1000 / 60;
/** Longest real time handed to the loop in one frame (tab switches etc.). */
const MAX_FRAME_MS = 250;
const MAX_TICKS_PER_FRAME = 6;
/** Ticks of drone history kept for the trail. */
const TRAIL_LEN = 32;

/** One live run: countdown, fixed 60 ticks/s loop, canvas, HUD, controls. */
export default function Round({ game, look, daily, best, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setFrame] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const control = useRef(new FlapControl());
  const prevY = useRef(game.y);
  const lastSpeed = useRef(0);
  const scroll = useRef(0);
  const trail = useRef<number[]>([]);
  const acc = useRef(0);
  const lastNow = useRef(0);
  const done = useRef(false);
  const popId = useRef(0);
  const cheered = useRef(best <= 0);
  const bursts = useRef(new Bursts());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const light = useSettings((s) => s.lightGraphics || s.reducedMotion);
  const shakeOn = useSettings((s) => s.screenShake && !s.reducedMotion);
  const keys = useSettings((s) => s.keys);

  const { now, start, pause, resume, paused, pausedRef } = useRunClock(undefined, () => done.current);
  const countdown = useCountdown(start);
  useGuardWhile(GAME_ID, countdown.done && game.over === null);

  const art = useRef<Look>({
    drone: findDrone(look.drone).art,
    trail: findTrail(look.trail).art,
    sky: findSky(look.sky).art,
    light,
  });
  art.current.light = light;

  const addPop = useCallback((ax: number, ay: number, text: string, tone: Pop["tone"], ms = 800) => {
    const id = ++popId.current;
    const x = Math.min(90, Math.max(10, (ax / rules.width) * 100));
    const y = Math.min(90, Math.max(8, (ay / rules.height) * 100));
    setPops((p) => [...p.slice(-5), { id, x, y, text, tone }]);
    window.setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), ms);
  }, []);

  /** A short shake (Web Animations, so the canvas isn't rebuilt). */
  const shakeBoard = useCallback(() => {
    wrapRef.current?.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(-5px, 2px)" },
        { transform: "translate(4px, -2px)" },
        { transform: "translate(-3px, -1px)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: 280 },
    );
  }, []);

  /** Sounds, sparks and pops for what happened on a tick. */
  const react = useCallback(
    (events: GameEvent[]) => {
      const px = wrapRef.current?.clientWidth ?? 360;
      const s = px / rules.width;
      const fx = !art.current.light;
      const sky = art.current.sky;
      for (const e of events) {
        switch (e.type) {
          case "flap":
            playSfx("whiff");
            break;
          case "pass":
            playSfx("tick");
            if (e.gaps % 10 === 0) {
              playSfx("chime");
              addPop(rules.width / 2, rules.height * 0.3, `${e.gaps} gaps`, "gold", 1100);
            }
            break;
          case "bar":
            playSfx("chomp");
            vibrate(8);
            if (fx) bursts.current.spawn(e.x * s, e.y * s, sky.accent, { count: 8, speed: 110, life: 360, size: 2.5 });
            addPop(e.x, e.y - 2400, "+1", "good", 650);
            break;
          case "crash":
            playSfx("lose");
            vibrate([50, 30, 80]);
            if (shakeOn) shakeBoard();
            if (fx) bursts.current.spawn(rules.drone_x * s, game.y * s, art.current.drone.body, { count: 16, speed: 170, life: 600, gravity: 320 });
            break;
        }
      }
      if (!cheered.current && game.s.score > best) {
        cheered.current = true;
        playSfx("reward");
        addPop(rules.width / 2, rules.height * 0.2, "New best", "gold", 1300);
      }
    },
    [game, best, addPop, shakeOn, shakeBoard],
  );

  const finishRun = useCallback((quitAt: number | null) => {
    if (done.current) return;
    done.current = true;
    control.current.reset();
    // Let the crash play out before the results.
    window.setTimeout(() => onDoneRef.current(control.current.log, quitAt), quitAt === null ? 1100 : 150);
  }, []);

  // Fit the canvas to its box (sharp on hi-dpi screens).
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = boardHeight(w);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    wrapRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // Dev builds only: lets automated browser checks read the board and flap.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __flap?: unknown };
    w.__flap = { game, control: control.current };
    return () => {
      delete w.__flap;
    };
  }, [game]);

  // The loop: fixed ticks from the game clock, smooth drawing in between.
  useEffect(() => {
    let raf = 0;
    let lastReal = performance.now();
    const loop = () => {
      const real = performance.now();
      const realDt = Math.min(real - lastReal, MAX_FRAME_MS);
      lastReal = real;
      const t = now();
      if (countdown.done && !pausedRef.current && game.over === null) {
        acc.current += Math.min(t - lastNow.current, MAX_FRAME_MS);
        let steps = 0;
        while (game.over === null && steps < MAX_TICKS_PER_FRAME && acc.current >= TICK_MS) {
          acc.current -= TICK_MS;
          prevY.current = game.y;
          const sp = game.speed;
          const wasStarted = game.started;
          const flap = control.current.next(game);
          game.step(flap);
          lastSpeed.current = wasStarted || game.started ? sp : 0;
          scroll.current += lastSpeed.current;
          trail.current.unshift(game.y);
          if (trail.current.length > TRAIL_LEN) trail.current.pop();
          react(game.events);
          steps++;
        }
        if (game.over !== null) finishRun(null);
        setFrame((f) => (f + 1) % 1_000_000);
      }
      lastNow.current = t;
      bursts.current.step(realDt);

      const cv = canvasRef.current;
      const ctx = cv?.getContext("2d");
      if (cv && ctx) {
        const dpr = cv.width / Math.max(1, cv.clientWidth);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const running = countdown.done && !pausedRef.current && game.over === null;
        const alpha = running ? Math.min(1, acc.current / TICK_MS) : 1;
        drawFrame(
          ctx,
          cv.clientWidth,
          {
            game,
            prevY: prevY.current,
            lastSpeed: lastSpeed.current,
            alpha,
            scroll: scroll.current,
            trail: trail.current,
            time: real,
            bursts: bursts.current,
            showScore: game.started,
          },
          art.current,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, now, pausedRef, countdown.done, react, finishRun]);

  const playing = countdown.done && !paused && game.over === null && !confirmEnd;

  const doPause = useCallback(() => {
    control.current.reset();
    pause();
  }, [pause]);

  const endRun = useCallback(() => {
    if (done.current || game.over !== null) return;
    const at = game.tick;
    game.quit();
    setConfirmEnd(false);
    resume();
    finishRun(at);
  }, [game, finishRun, resume]);

  // Keyboard.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actionForKey(e.code, useSettings.getState().keys);
      if (a === null) return;
      e.preventDefault();
      if (a === "pause") {
        if (e.repeat || !countdown.done || game.over !== null || confirmEnd) return;
        if (paused) resume();
        else doPause();
        return;
      }
      if (playing && !e.repeat) control.current.press();
    };
    const onBlur = () => control.current.reset();
    window.addEventListener("keydown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [playing, paused, resume, doPause, countdown.done, game, confirmEnd]);

  // Mouse and touch: any press on the board flaps.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!playing) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    control.current.press();
  };

  const g = game;
  const pauseKey = keyLabel(keysFor(GAME_ID, "pause", keys)[1] ?? "KeyP");
  const flapKey = keyLabel(keysFor(GAME_ID, "flap", keys)[0] ?? "Space");
  const touchOnly = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  return (
    <div className="flap-round">
      <div className="flap-hud panel" aria-live="off">
        <div className="wam-stat">
          <small>Score</small>
          <strong>{g.s.score}</strong>
        </div>
        <div className="wam-stat">
          <small>Gaps</small>
          <strong>{g.s.gaps}</strong>
        </div>
        <div className="wam-stat">
          <small>Bars</small>
          <strong>{g.s.bars}</strong>
        </div>
        {!daily && (
          <div className="wam-stat">
            <small>Best</small>
            <strong>{Math.max(best, g.s.score)}</strong>
          </div>
        )}
        <div className="wam-hud-btns">
          <button className="btn-ghost btn-sm" onClick={paused ? resume : doPause} disabled={!countdown.done || g.over !== null || confirmEnd}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="btn-ghost btn-sm"
            disabled={!countdown.done || g.over !== null}
            onClick={() => {
              doPause();
              setConfirmEnd(true);
            }}
          >
            End run
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="flap-board"
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={`Signal Flap board. Score ${g.s.score}, ${g.s.gaps} gaps passed.`}
      >
        <canvas ref={canvasRef} />
        {pops.map((p) => (
          <span key={p.id} className={`flap-pop ${p.tone}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true">
            {p.text}
          </span>
        ))}
        {playing && !g.started && (
          <span className="flap-start" aria-hidden="true">
            {touchOnly ? "Tap the board to take off" : `Click the board or press ${flapKey} to take off`}
          </span>
        )}
        {g.over !== null && g.over !== "quit" && (
          <div className={`wam-overlay flap-ko ${g.over}`} role="status">
            <strong>{END_TEXT[g.over]}</strong>
          </div>
        )}
        {confirmEnd ? (
          <div className="wam-overlay">
            <div className="wam-paused">
              <strong>End this run?</strong>
              <small>Your score so far still counts{daily ? " (it's your one Daily try)" : ""}.</small>
              <div className="game-controls">
                <button className="btn-green" onClick={endRun}>
                  End run
                </button>
                <button
                  className="btn-ghost"
                  autoFocus
                  onClick={() => {
                    setConfirmEnd(false);
                    resume();
                  }}
                >
                  Keep playing
                </button>
              </div>
            </div>
          </div>
        ) : (
          <RunOverlay countdown={countdown.label} paused={paused && g.over === null} onResume={resume} hint={`Press ${pauseKey} to resume`} />
        )}
      </div>
      <p className="wam-hint flap-help">
        {touchOnly ? "Tap anywhere on the board to flap." : `Click the board or press ${flapKey} to flap. ${pauseKey} pauses.`}
      </p>
    </div>
  );
}
