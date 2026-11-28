import { useCallback, useEffect, useRef, useState } from "react";
import { RunOverlay, useCountdown } from "../../components/run/Countdown";
import PingCanvas from "../../mascot/PingCanvas";
import type { Pose } from "../../mascot/sprite";
import { Bursts } from "../../platform/burst";
import { keyLabel, keysFor } from "../../platform/keymap";
import { useGuardWhile } from "../../platform/leaveGuard";
import { useRunClock } from "../../platform/runClock";
import { playSfx } from "../../platform/sound";
import { useSettings, vibrate } from "../../store/settings";
import type { Bot } from "./bot";
import { rules, type Game, type GameEvent, type Input, type Paddle } from "./engine";
import { GAME_ID, RallyControl, actionForKey, courtY } from "./input";
import { findBall, findCourt, findPaddle, findPower } from "./items";
import PowerIcon from "./PowerIcon";
import { boardHeight, drawFrame, RING_MS, type Look, type Ring } from "./render";

export interface RoundLook {
  paddle: string;
  ball: string;
  court: string;
}

interface Props {
  game: Game;
  bot: Bot;
  look: RoundLook;
  /** Zero-Bot's level name ("Hard"). */
  rival: string;
  buttons: boolean;
  /** Match over: your logged inputs, and the quit tick if you left. */
  onDone: (inputs: Input[], quitAt: number | null) => void;
}

const TICK_MS = 1000 / 60;
const MAX_FRAME_MS = 250;
const MAX_TICKS_PER_FRAME = 6;
/** Zero-Bot's paddle: a plain bar in the court's net colour. */
const BOT_PADDLE = { style: "solid", color: "#C9CED8", edge: "#C9CED8" } as const;

/** What a used power is doing now. */
function powerState(p: Paddle, rival: Paddle, slot: number): string {
  if (!p.used[slot]) return "Ready";
  const secs = (t: number) => `${Math.ceil(t / 60)} s`;
  switch (p.kit[slot]) {
    case "grow":
      return p.grow > 0 ? secs(p.grow) : "Used";
    case "shield":
      return p.shield > 0 ? secs(p.shield) : "Used";
    case "echo":
      return p.echo > 0 ? secs(p.echo) : "Used";
    case "shrink":
      return rival.shrink > 0 ? secs(rival.shrink) : "Used";
    case "freeze":
      return rival.freeze > 0 ? secs(rival.freeze) : "Used";
    case "fog":
      return rival.fog > 0 ? secs(rival.fog) : "Used";
    case "smash":
      return p.smash ? "Next return" : "Used";
    case "curve":
      return p.curve ? "Next return" : "Used";
    case "ghost":
      return p.ghost ? "Next return" : "Used";
    default:
      return "Used";
  }
}

/** One live match against Zero-Bot: countdown, fixed 60 ticks/s loop, court, HUD, controls. */
export default function Round({ game, bot, look, rival, buttons, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setFrame] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [call, setCall] = useState<{ text: string; pose: Pose | null }>({ text: "First to " + game.target, pose: null });
  const control = useRef(new RallyControl());
  const prevPads = useRef<[number, number]>([game.pads[0].y, game.pads[1].y]);
  const prevBalls = useRef<{ x: number; y: number }[]>([]);
  const rings = useRef<Ring[]>([]);
  const acc = useRef(0);
  const lastNow = useRef(0);
  const done = useRef(false);
  const callTimer = useRef(0);
  const bursts = useRef(new Bursts());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const light = useSettings((s) => s.lightGraphics || s.reducedMotion);
  const keys = useSettings((s) => s.keys);

  const { now, start, pause, resume, paused, pausedRef } = useRunClock(undefined, () => done.current);
  const countdown = useCountdown(start);
  useGuardWhile(GAME_ID, countdown.done && game.over === null);

  const art = useRef<Look>({
    paddles: [findPaddle(look.paddle).art, BOT_PADDLE],
    ball: findBall(look.ball).art,
    court: findCourt(look.court).art,
    light,
  });
  art.current.light = light;

  /** Ping the referee calls it. */
  const referee = useCallback((text: string, pose: Pose | null, ms = 1600) => {
    setCall({ text, pose });
    window.clearTimeout(callTimer.current);
    callTimer.current = window.setTimeout(() => setCall((c) => ({ ...c, pose: null })), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(callTimer.current), []);

  /** Sounds, rings and calls for what happened on a tick. */
  const react = useCallback(
    (events: GameEvent[]) => {
      const px = wrapRef.current?.clientWidth ?? 640;
      const s = px / rules.width;
      const fx = !art.current.light;
      const court = art.current.court;
      for (const e of events) {
        switch (e.type) {
          case "serve":
            playSfx("click");
            break;
          case "hit":
            playSfx("batPong");
            if (fx) rings.current.push({ x: e.x, y: e.y, born: performance.now(), color: court.accent });
            break;
          case "wall":
            playSfx("tick");
            break;
          case "shield":
            playSfx("clang");
            if (fx) bursts.current.spawn((e.side === 0 ? 0 : rules.width) * s, e.y * s, court.accent, { count: 10, speed: 120, life: 400 });
            referee(e.side === 0 ? "Your shield held" : "Zero-Bot's shield held", "echo");
            break;
          case "fire": {
            playSfx("powerup");
            const name = findPower(e.power).name;
            referee(e.side === 0 ? `${name}` : `Zero-Bot used ${name}`, "ping", 1200);
            break;
          }
          case "point": {
            const g = game;
            const mine = e.side === 0;
            playSfx(mine ? "chime" : "drop");
            if (!mine) vibrate(30);
            const [a, b] = g.s.score;
            const matchPoint = g.over === null && (a === g.target - 1 || b === g.target - 1);
            referee(
              mine ? `Point to you. ${a}–${b}${matchPoint ? ", match point" : ""}` : `Point to Zero-Bot. ${a}–${b}${matchPoint ? ", match point" : ""}`,
              mine ? "flap" : "look",
            );
            break;
          }
          case "over":
            break;
        }
      }
    },
    [game, referee],
  );

  const finishMatch = useCallback((quitAt: number | null) => {
    if (done.current) return;
    done.current = true;
    control.current.reset();
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

  // Dev builds only: lets automated browser checks read the court and play.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __rally?: unknown };
    w.__rally = { game, control: control.current };
    return () => {
      delete w.__rally;
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
          prevPads.current = [game.pads[0].y, game.pads[1].y];
          prevBalls.current = game.balls.map((b) => ({ x: b.x, y: b.y }));
          const mine = control.current.next(game);
          const theirs = bot.control(game);
          game.step([mine, theirs]);
          react(game.events);
          steps++;
        }
        if (game.over !== null) finishMatch(null);
        setFrame((f) => (f + 1) % 1_000_000);
      }
      lastNow.current = t;
      bursts.current.step(realDt);
      rings.current = rings.current.filter((r) => real - r.born < RING_MS);

      const cv = canvasRef.current;
      const ctx = cv?.getContext("2d");
      if (cv && ctx) {
        const dpr = cv.width / Math.max(1, cv.clientWidth);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const running = countdown.done && !pausedRef.current && game.over === null;
        drawFrame(
          ctx,
          cv.clientWidth,
          {
            game,
            prevPads: prevPads.current,
            prevBalls: prevBalls.current,
            alpha: running ? Math.min(1, acc.current / TICK_MS) : 1,
            rings: rings.current,
            time: real,
            bursts: bursts.current,
            me: 0,
          },
          art.current,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, bot, now, pausedRef, countdown.done, react, finishMatch]);

  const playing = countdown.done && !paused && game.over === null && !confirmLeave;

  const doPause = useCallback(() => {
    control.current.reset();
    pause();
  }, [pause]);

  const leave = useCallback(() => {
    if (done.current || game.over !== null) return;
    const at = game.tick;
    game.quit(0);
    setConfirmLeave(false);
    resume();
    finishMatch(at);
  }, [game, finishMatch, resume]);

  // Keyboard.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actionForKey(e.code, useSettings.getState().keys);
      if (a === null) return;
      e.preventDefault();
      if (a === "pause") {
        if (e.repeat || !countdown.done || game.over !== null || confirmLeave) return;
        if (paused) resume();
        else doPause();
        return;
      }
      if (!playing) return;
      if (a === "up") control.current.up = true;
      else if (a === "down") control.current.down = true;
      else if (!e.repeat) control.current.fire(a === "power1" ? 0 : a === "power2" ? 1 : 2);
    };
    const onUp = (e: KeyboardEvent) => {
      const a = actionForKey(e.code, useSettings.getState().keys);
      if (a === "up") control.current.up = false;
      else if (a === "down") control.current.down = false;
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
  }, [playing, paused, resume, doPause, countdown.done, game, confirmLeave]);

  // Mouse and touch on the court: the paddle follows the pointer's height.
  const pointAt = (clientY: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    control.current.point(courtY((clientY - r.top) / Math.max(1, r.height)));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!playing) return;
    if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
    pointAt(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!playing) return;
    if (e.pointerType === "mouse" || e.buttons > 0 || e.currentTarget.hasPointerCapture(e.pointerId)) pointAt(e.clientY);
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
  const me = g.pads[0];
  const them = g.pads[1];
  const chaos = me.kit.length > 0;
  const pauseKey = keyLabel(keysFor(GAME_ID, "pause", keys)[1] ?? "KeyP");
  const upKey = keyLabel(keysFor(GAME_ID, "up", keys)[0] ?? "ArrowUp");
  const downKey = keyLabel(keysFor(GAME_ID, "down", keys)[0] ?? "ArrowDown");
  const powerKeys = (["power1", "power2", "power3"] as const).map((a, i) => keyLabel(keysFor(GAME_ID, a, keys)[0] ?? `Digit${i + 1}`));


  return (
    <div className="rally-round">
      <div className="rally-hud panel" aria-live="off">
        <div className="rally-side">
          <small>You</small>
          <strong>{g.s.score[0]}</strong>
        </div>
        <div className="rally-ref">
          <PingCanvas pose={call.pose} scale={1} still={light} className="rally-ref-ping" />
          <span className="rally-call" role="status" aria-live="polite">
            {call.text}
          </span>
        </div>
        <div className="rally-side right">
          <small>Zero-Bot · {rival}</small>
          <strong>{g.s.score[1]}</strong>
        </div>
        <div className="wam-hud-btns rally-hud-btns">
          <button className="btn-ghost btn-sm" onClick={paused ? resume : doPause} disabled={!countdown.done || g.over !== null || confirmLeave}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="btn-ghost btn-sm"
            disabled={!countdown.done || g.over !== null}
            onClick={() => {
              doPause();
              setConfirmLeave(true);
            }}
          >
            Leave
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="rally-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={`Echo Rally court. You ${g.s.score[0]}, Zero-Bot ${g.s.score[1]}, first to ${g.target}.`}
      >
        <canvas ref={canvasRef} />
        {g.over !== null && g.over !== "quit" && (
          <div className={`wam-overlay rally-ko ${g.s.winner === 0 ? "won" : "lost"}`} role="status">
            <strong>{g.s.winner === 0 ? "You win the match" : g.s.winner === 1 ? "Zero-Bot wins the match" : "Time's up"}</strong>
          </div>
        )}
        {confirmLeave ? (
          <div className="wam-overlay">
            <div className="wam-paused">
              <strong>Leave this match?</strong>
              <small>It counts as a loss and pays nothing.</small>
              <div className="game-controls">
                <button className="btn-green" onClick={leave}>
                  Leave match
                </button>
                <button
                  className="btn-ghost"
                  autoFocus
                  onClick={() => {
                    setConfirmLeave(false);
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

      {chaos && (
        <div className="rally-powers">
          <div className="rally-kit" role="group" aria-label="Your powers">
            {me.kit.map((p, i) => {
              const state = powerState(me, them, i);
              const ready = !me.used[i];
              return (
                <button
                  key={p}
                  type="button"
                  className={`rally-power${ready ? "" : " used"}${state !== "Ready" && state !== "Used" ? " active" : ""}`}
                  disabled={!ready || !playing}
                  onPointerDown={(e) => {
                    // Fire on press, not release: timing matters.
                    e.preventDefault();
                    if (playing) control.current.fire(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (playing) control.current.fire(i);
                    }
                  }}
                  aria-label={`${findPower(p).name}: ${findPower(p).text} ${state}`}
                >
                  <PowerIcon power={p} />
                  <span className="rally-power-name">{findPower(p).name}</span>
                  <small>{state}</small>
                  {!buttons && <kbd>{powerKeys[i]}</kbd>}
                </button>
              );
            })}
          </div>
          {them.kit.length > 0 && (
            <div className="rally-botkit" aria-label="Zero-Bot's powers">
              <small>Zero-Bot brings</small>
              <ul>
                {them.kit.map((p, i) => (
                  <li key={p} className={them.used[i] ? "used" : ""} title={findPower(p).text}>
                    <PowerIcon power={p} size={16} />
                    {findPower(p).name}
                    {them.used[i] && <span className="sr-only"> (used)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {buttons && (
        <div className="rally-pads" role="group" aria-label="Paddle controls">
          <button
            type="button"
            className="rally-pad"
            aria-label="Move up"
            {...hold(
              () => (control.current.up = true),
              () => (control.current.up = false),
            )}
          >
            ▲
          </button>
          <button
            type="button"
            className="rally-pad"
            aria-label="Move down"
            {...hold(
              () => (control.current.down = true),
              () => (control.current.down = false),
            )}
          >
            ▼
          </button>
        </div>
      )}
      <p className="wam-hint rally-turn">Turn your phone sideways for a bigger court.</p>
      <p className="wam-hint rally-help">
        {buttons
          ? "Drag on the court or hold the arrows."
          : `Move the mouse or drag on the court, or use ${upKey} ${downKey}.`}
        {chaos && !buttons ? ` ${powerKeys.join(" ")} fire your powers.` : ""} {pauseKey} pauses.
      </p>
    </div>
  );
}
