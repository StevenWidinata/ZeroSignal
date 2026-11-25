import { useCallback, useEffect, useRef, useState } from "react";
import { RunOverlay, useCountdown } from "../../components/run/Countdown";
import { Bursts } from "../../platform/burst";
import { keyLabel, keysFor } from "../../platform/keymap";
import { useGuardWhile } from "../../platform/leaveGuard";
import { useRunClock } from "../../platform/runClock";
import { playSfx } from "../../platform/sound";
import { useSettings, vibrate } from "../../store/settings";
import { rules, type Drop, type Game, type GameEvent, type Input } from "./engine";
import { GAME_ID, PaddleControl, actionForKey, arenaX } from "./input";
import { findBackdrop, findBall, findPaddle, findTheme } from "./items";
import { DROP_INFO, END_TEXT } from "./modes";
import { boardHeight, drawFrame, type Look } from "./render";

interface Pop {
  id: number;
  /** Board position in % (0..100). */
  x: number;
  y: number;
  text: string;
  tone: "good" | "gold" | "bad" | "combo";
}

export interface RoundLook {
  paddle: string;
  ball: string;
  theme: string;
  backdrop: string;
}

interface Props {
  game: Game;
  /** The Campaign level, or null for waves. */
  level: { id: number; name: string } | null;
  look: RoundLook;
  buttons: boolean;
  daily: boolean;
  /** Run over: every input fed to the engine, and the quit tick if you quit. */
  onDone: (inputs: Input[], quitAt: number | null) => void;
}

const TICK_MS = 1000 / 60;
/** Longest real time handed to the loop in one frame (tab switches etc.). */
const MAX_FRAME_MS = 250;
const MAX_TICKS_PER_FRAME = 6;
/** A touch that moves less than this and lifts quickly is a tap (launch). */
const TAP_PX = 12;
const TAP_MS = 300;

const TIMED: { key: "wide" | "slow" | "laser" | "sticky"; drop: Drop }[] = [
  { key: "wide", drop: "wide" },
  { key: "slow", drop: "slow" },
  { key: "laser", drop: "laser" },
  { key: "sticky", drop: "sticky" },
];

/** One live run: countdown, fixed 60 ticks/s loop, canvas, HUD, controls. */
export default function Round({ game, level, look, buttons, daily, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setFrame] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const control = useRef(new PaddleControl());
  const prevPaddle = useRef(game.paddle_x);
  const prevBalls = useRef<[number, number][]>(game.balls.map((b) => [b.x, b.y]));
  const acc = useRef(0);
  const lastNow = useRef(0);
  const done = useRef(false);
  const popId = useRef(0);
  const lastMult = useRef(1);
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
    paddle: findPaddle(look.paddle).art,
    ball: findBall(look.ball).art,
    theme: findTheme(look.theme).art,
    backdrop: findBackdrop(look.backdrop).art,
    light,
  });
  art.current.light = light;

  const addPop = useCallback((ax: number, ay: number, text: string, tone: Pop["tone"], ms = 800) => {
    const id = ++popId.current;
    const x = Math.min(92, Math.max(8, (ax / rules.width) * 100));
    const y = Math.min(94, Math.max(6, (ay / rules.height) * 100));
    setPops((p) => [...p.slice(-6), { id, x, y, text, tone }]);
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
      const th = art.current.theme;
      let chain = 0;
      let chainAt: [number, number] = [0, 0];
      for (const e of events) {
        switch (e.type) {
          case "paddle":
            playSfx("bonk");
            break;
          case "hit":
            playSfx(e.kind === "s" ? "clang" : "clank");
            if (fx) bursts.current.spawn(e.x * s, e.y * s, e.kind === "s" ? th.steel : th.tough, { count: 5, speed: 90, life: 260, size: 2 });
            break;
          case "break":
            playSfx("land");
            vibrate(6);
            if (fx) bursts.current.spawn(e.x * s, e.y * s, e.kind === "t" ? th.tough : th.rows[0], { count: 10, speed: 140, life: 420, gravity: 260 });
            break;
          case "explode":
            if (e.chain >= chain) {
              chain = e.chain;
              chainAt = [e.x, e.y];
            }
            if (fx) bursts.current.spawn(e.x * s, e.y * s, th.explosive, { count: 18, speed: 220, life: 520 });
            break;
          case "catch":
            playSfx("powerup");
            vibrate(15);
            addPop(e.x, rules.paddle_y - 2400, DROP_INFO[e.drop].name, "good", 1000);
            break;
          case "fire":
            playSfx("zap");
            break;
          case "launch":
            playSfx("whiff");
            break;
          case "lose":
            playSfx("lose");
            vibrate([50, 30, 80]);
            if (shakeOn) shakeBoard();
            addPop(rules.width / 2, rules.height * 0.6, e.lives > 0 ? `Ball lost, ${e.lives} ${e.lives === 1 ? "life" : "lives"} left` : "Out of lives", "bad", 1300);
            break;
          case "wave":
            playSfx("chime");
            addPop(rules.width / 2, rules.height * 0.5, `Wave ${e.wave}`, "gold", 1500);
            break;
          case "clear":
            playSfx("win");
            break;
          case "wall":
            break;
        }
      }
      if (chain > 0) {
        playSfx("boom");
        vibrate([20, 15, 30]);
        if (shakeOn && chain >= 3) shakeBoard();
        if (chain >= 3) addPop(chainAt[0], chainAt[1], `Chain of ${chain}`, "gold", 1100);
      }
      const m = game.mult();
      if (m > lastMult.current && m > 1) {
        if (m >= 3) playSfx("chime");
        addPop(rules.width / 2, rules.paddle_y - 9000, `Combo ×${m}`, "combo", 900);
      }
      lastMult.current = m;
    },
    [game, addPop, shakeOn, shakeBoard],
  );

  const finishRun = useCallback((quitAt: number | null) => {
    if (done.current) return;
    done.current = true;
    control.current.reset();
    // Let the last moment play out before the results.
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

  // Dev builds only: lets automated browser checks read the board and steer.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __brick?: unknown };
    w.__brick = { game, control: control.current };
    return () => {
      delete w.__brick;
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
          prevPaddle.current = game.paddle_x;
          prevBalls.current = game.balls.map((b) => [b.x, b.y]);
          const { target, launch, fire } = control.current.next(game);
          game.step(target, launch, fire);
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
        const alpha = game.over !== null ? 1 : Math.min(1, acc.current / TICK_MS);
        drawFrame(
          ctx,
          cv.clientWidth,
          { game, prevPaddle: prevPaddle.current, prevBalls: prevBalls.current, alpha, time: real, bursts: bursts.current },
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
      if (!playing) return;
      if (a === "left") control.current.left = true;
      else if (a === "right") control.current.right = true;
      else if (!e.repeat) control.current.press();
    };
    const onUp = (e: KeyboardEvent) => {
      const a = actionForKey(e.code, useSettings.getState().keys);
      if (a === "left") control.current.left = false;
      else if (a === "right") control.current.right = false;
      else if (a === "launch") control.current.release();
    };
    const onBlur = () => control.current.reset();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [playing, paused, resume, doPause, countdown.done, game, confirmEnd]);

  // Mouse and touch on the board: point the paddle, click or tap to launch.
  const touch = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const pointAt = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    control.current.point(arenaX((clientX - r.left) / Math.max(1, r.width)));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!playing) return;
    pointAt(e.clientX);
    if (e.pointerType === "mouse") {
      if (e.button === 0) control.current.press();
      return;
    }
    touch.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    // Holding a finger down keeps the laser firing.
    control.current.held = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!playing) return;
    if (e.pointerType === "mouse" || touch.current?.id === e.pointerId) pointAt(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      control.current.release();
      return;
    }
    const tc = touch.current;
    touch.current = null;
    control.current.release();
    if (playing && tc && tc.id === e.pointerId) {
      const moved = Math.hypot(e.clientX - tc.x, e.clientY - tc.y);
      if (moved < TAP_PX && performance.now() - tc.t < TAP_MS) {
        control.current.press();
        control.current.release();
      }
    }
  };

  /** Hold-down phone buttons. */
  const hold = (on: () => void, off: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      if (playing) on();
    },
    onPointerUp: off,
    onPointerLeave: off,
    onPointerCancel: off,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const g = game;
  const secs = (ticks: number) => Math.ceil(ticks / 60);
  const active = TIMED.filter((d) => g[d.key] > 0);
  const stuck = g.balls.some((b) => b.stuck !== null);
  const pauseKey = keyLabel(keysFor(GAME_ID, "pause", keys)[1] ?? "KeyP");
  const launchKey = keyLabel(keysFor(GAME_ID, "launch", keys)[0] ?? "Space");
  const mult = g.mult();

  return (
    <div className="brick-round">
      <div className="brick-hud panel" aria-live="off">
        <div className="wam-stat">
          <small>Score</small>
          <strong>{g.s.score.toLocaleString()}</strong>
        </div>
        <div className="wam-stat">
          <small>Lives</small>
          <strong className="brick-lives" aria-label={`${g.lives} lives`}>
            {g.lives}
          </strong>
        </div>
        <div className="wam-stat">
          <small>{level ? "Level" : "Wave"}</small>
          <strong>{level ? level.id : g.s.wave}</strong>
        </div>
        <div className={`wam-stat brick-combo${mult > 1 ? " hot" : ""}`}>
          <small>Combo</small>
          <strong>×{mult}</strong>
        </div>
        <div className="brick-drops" aria-label="Active drops">
          {active.map((d) => (
            <span key={d.key} className="brick-chip">
              <span className="brick-chip-dot" style={{ background: DROP_INFO[d.drop].color }} aria-hidden="true" />
              {DROP_INFO[d.drop].name} {secs(g[d.key])}s
            </span>
          ))}
        </div>
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
        className="brick-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`Brick Breaker board. ${g.bricks.filter((b) => b.alive && b.kind !== "s").length} bricks left, ${g.lives} lives, score ${g.s.score}.`}
      >
        <canvas ref={canvasRef} />
        {pops.map((p) => (
          <span key={p.id} className={`brick-pop ${p.tone}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true">
            {p.text}
          </span>
        ))}
        {playing && stuck && g.tick < 240 && (
          <span className="brick-serve" aria-hidden="true">
            {buttons ? "Tap the board or press Launch" : `Click or press ${launchKey} to launch`}
          </span>
        )}
        {g.over !== null && g.over !== "quit" && (
          <div className={`wam-overlay brick-ko ${g.over}`} role="status">
            <strong>{END_TEXT[g.over]}</strong>
          </div>
        )}
        {confirmEnd ? (
          <div className="wam-overlay">
            <div className="wam-paused">
              <strong>End this run?</strong>
              <small>
                {level
                  ? "The level won't count as cleared."
                  : `Your score so far still counts${daily ? " (it's your one Daily try)" : ""}.`}
              </small>
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

      {buttons && (
        <div className="brick-pads" role="group" aria-label="Paddle controls">
          <button
            type="button"
            className="brick-pad"
            aria-label="Slide left"
            {...hold(
              () => (control.current.left = true),
              () => (control.current.left = false),
            )}
          >
            ◀
          </button>
          <button
            type="button"
            className="brick-pad launch"
            {...hold(
              () => control.current.press(),
              () => control.current.release(),
            )}
          >
            {g.laser > 0 && !stuck ? "Fire" : "Launch"}
          </button>
          <button
            type="button"
            className="brick-pad"
            aria-label="Slide right"
            {...hold(
              () => (control.current.right = true),
              () => (control.current.right = false),
            )}
          >
            ▶
          </button>
        </div>
      )}
      <p className="wam-hint brick-help">
        {buttons
          ? "Drag on the board or hold the arrows. Launch also fires the laser."
          : `Move the mouse or drag on the board, or use ${keyLabel(keysFor(GAME_ID, "left", keys)[0] ?? "ArrowLeft")} ${keyLabel(keysFor(GAME_ID, "right", keys)[0] ?? "ArrowRight")}. ${launchKey} launches and fires.`}{" "}
        {pauseKey} pauses.
      </p>
    </div>
  );
}
