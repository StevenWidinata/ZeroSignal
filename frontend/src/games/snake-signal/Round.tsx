import { useCallback, useEffect, useRef, useState } from "react";
import { RunOverlay, useCountdown } from "../../components/run/Countdown";
import { Bursts } from "../../platform/burst";
import { keyLabel, keysFor } from "../../platform/keymap";
import { useGuardWhile } from "../../platform/leaveGuard";
import { useRunClock } from "../../platform/runClock";
import { playSfx } from "../../platform/sound";
import { useSettings, vibrate } from "../../store/settings";
import { rules, type Dir, type Game, type SnakeEvent } from "./engine";
import { GAME_ID, TurnQueue, dirForKey, isPauseKey, swipeToDir } from "./input";
import { findArena, findSkin, findTrail } from "./items";
import { END_TEXT } from "./modes";
import { POWER_ICON, POWER_NAME, drawFrame } from "./render";

interface Pop {
  id: number;
  /** Board position in % (0..100). */
  x: number;
  y: number;
  text: string;
  tone: "good" | "gold" | "power" | "bad" | "combo";
}

interface Props {
  game: Game;
  skin: string;
  arena: string;
  trail: string;
  dpad: boolean;
  /** Run over: every turn fed to the engine, and the quit tick if you quit. */
  onDone: (turns: [number, Dir][], quitAt: number | null) => void;
}

/** Longest real time handed to the loop in one frame (tab switches etc.). */
const MAX_FRAME_MS = 250;
const MAX_TICKS_PER_FRAME = 5;

/** One live run: countdown, fixed-tick loop, canvas, HUD, steering. */
export default function Round({ game, skin, arena, trail, dpad, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, setFrame] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const turns = useRef<[number, Dir][]>([]);
  const queue = useRef(new TurnQueue());
  const prev = useRef<number[]>([...game.snake]);
  const acc = useRef(0);
  const lastNow = useRef(0);
  const done = useRef(false);
  const popId = useRef(0);
  const bursts = useRef(new Bursts());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const light = useSettings((s) => s.lightGraphics || s.reducedMotion);
  const shakeOn = useSettings((s) => s.screenShake && !s.reducedMotion);
  const keys = useSettings((s) => s.keys);

  const { now, start, pause, resume, paused, pausedRef } = useRunClock(undefined, () => done.current);
  const countdown = useCountdown(start);
  useGuardWhile(GAME_ID, countdown.done && game.over === null);

  const look = useRef({ skin: findSkin(skin).art, arena: findArena(arena).art, trail: findTrail(trail).art, light });
  look.current = { skin: findSkin(skin).art, arena: findArena(arena).art, trail: findTrail(trail).art, light };

  const addPop = useCallback((cell: number | null, text: string, tone: Pop["tone"], ms = 800) => {
    const id = ++popId.current;
    const n = game.n;
    const c = cell ?? game.head();
    const x = (((c % n) + 0.5) / n) * 100;
    const y = ((Math.trunc(c / n) + 0.5) / n) * 100;
    setPops((p) => [...p.slice(-8), { id, x, y, text, tone }]);
    window.setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), ms);
  }, [game]);

  /** A short shake (Web Animations, so the canvas isn't rebuilt). */
  const shakeBoard = useCallback(() => {
    wrapRef.current?.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(-6px, 2px)" },
        { transform: "translate(5px, -3px)" },
        { transform: "translate(-4px, -2px)" },
        { transform: "translate(3px, 2px)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: 350 },
    );
  }, []);

  /** Sounds, sparks and pops for what happened on a tick. */
  const react = useCallback(
    (events: SnakeEvent[]) => {
      const px = wrapRef.current?.clientWidth ?? 400;
      const cell = px / game.n;
      const at = (c: number): [number, number] => [((c % game.n) + 0.5) * cell, (Math.trunc(c / game.n) + 0.5) * cell];
      const fx = !look.current.light;
      for (const e of events) {
        switch (e.type) {
          case "food":
            playSfx("chomp");
            vibrate(8);
            if (fx) bursts.current.spawn(...at(e.cell), look.current.arena.food, { count: 10, speed: cell * 4, life: 380 });
            addPop(e.cell, `+${e.points}`, "good", 650);
            break;
          case "golden":
            playSfx("golden");
            vibrate([15, 20, 15]);
            if (fx) bursts.current.spawn(...at(e.cell), "#ffd84d", { count: 22, speed: cell * 6, life: 600 });
            addPop(e.cell, `★ +${e.points}`, "gold", 900);
            break;
          case "power":
            playSfx("powerup");
            vibrate(20);
            if (fx) bursts.current.spawn(...at(e.cell), "#ffffff", { count: 18, speed: cell * 5, life: 550 });
            addPop(e.cell, `${POWER_ICON[e.kind]} ${POWER_NAME[e.kind]}`, "power", 1100);
            break;
          case "bug_eaten":
            playSfx("fever");
            vibrate([30, 20, 50]);
            if (fx) bursts.current.spawn(...at(e.cell), "#ff3fa4", { count: 30, speed: cell * 7, life: 800 });
            addPop(e.cell, `👾 GLITCH EATEN +${e.points}`, "gold", 1300);
            break;
          case "close_call":
            playSfx("whiff");
            addPop(null, `Close call! +${e.points}`, "combo", 900);
            break;
          case "combo":
            if (e.mult >= 3) playSfx("chime");
            addPop(null, `COMBO ×${e.mult}`, "combo", 900);
            break;
          case "hazard":
            playSfx("glitch");
            break;
          case "bug_spawn":
            playSfx("zap");
            addPop(game.bug?.cell ?? null, "👾 A glitch bug!", "bad", 1200);
            break;
          case "crash":
            if (e.why === "quit") break;
            playSfx(e.why === "signal" ? "lose" : "boom");
            vibrate([60, 40, 90]);
            if (fx) bursts.current.spawn(...at(game.head()), "#ff3f5e", { count: 36, speed: cell * 8, life: 900 });
            if (shakeOn) shakeBoard();
            break;
        }
      }
    },
    [game, addPop, shakeOn, shakeBoard],
  );

  const finishRun = useCallback(
    (quitAt: number | null) => {
      if (done.current) return;
      done.current = true;
      // Let the crash play out for a moment before the results.
      window.setTimeout(() => onDoneRef.current(turns.current, quitAt), quitAt === null ? 900 : 150);
    },
    [],
  );

  // Fit the canvas to its box (sharp on hi-dpi screens).
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const fit = () => {
      const px = el.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(px * dpr);
      cv.height = Math.round(px * dpr);
      cv.style.width = `${px}px`;
      cv.style.height = `${px}px`;
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
    const w = window as unknown as { __snake?: unknown };
    w.__snake = { game, steer: (d: Dir) => queue.current.push(d, game.dir) };
    return () => {
      delete w.__snake;
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
        while (game.over === null && steps < MAX_TICKS_PER_FRAME) {
          const ms = game.tickMs();
          if (acc.current < ms) break;
          acc.current -= ms;
          prev.current = [...game.snake];
          const turn = queue.current.take(game.dir);
          if (turn !== null) turns.current.push([game.tick, turn]);
          game.step(turn);
          // Trail sparks from the tail end.
          const tr = look.current.trail;
          if (tr.style !== "none" && !look.current.light) {
            const px = wrapRef.current?.clientWidth ?? 400;
            const cell = px / game.n;
            const tail = game.snake[game.snake.length - 1];
            const x = ((tail % game.n) + 0.5) * cell;
            const y = (Math.trunc(tail / game.n) + 0.5) * cell;
            const opts =
              tr.style === "comet"
                ? { count: 4, speed: cell * 1.2, life: 900, size: 4 }
                : tr.style === "bubbles"
                  ? { count: 2, speed: cell * 0.8, life: 700, size: 5, gravity: -cell * 3 }
                  : tr.style === "glitch"
                    ? { count: 3, speed: cell * 2.5, life: 260, size: 4 }
                    : { count: 3, speed: cell * 1.5, life: 450, size: 2.5 };
            bursts.current.spawn(x, y, tr.color, opts);
          }
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
        const alpha = game.over !== null ? 1 : Math.min(1, acc.current / game.tickMs());
        drawFrame(ctx, cv.clientWidth, { game, prev: prev.current, alpha, time: real, bursts: bursts.current }, look.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, now, pausedRef, countdown.done, react, finishRun]);

  const steer = useCallback(
    (d: Dir) => {
      if (!countdown.done || paused || game.over !== null) return;
      queue.current.push(d, game.dir);
    },
    [countdown.done, paused, game],
  );

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
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = useSettings.getState().keys;
      if (isPauseKey(e.code, k)) {
        e.preventDefault();
        if (e.repeat) return;
        if (paused) resume();
        else pause();
        return;
      }
      const d = dirForKey(e.code, k);
      if (d === null) return;
      e.preventDefault();
      if (!e.repeat) steer(d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steer, pause, resume, paused]);

  // Swipes: a drag can make several turns (the start point moves on).
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const d = swipeToDir(e.clientX - s.x, e.clientY - s.y, 22);
    if (d !== null) {
      steer(d);
      swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  };
  const onPointerUp = () => {
    swipe.current = null;
  };

  const g = game;
  const comboLeft = g.lastEat === null || g.combo === 0 ? 0 : Math.max(0, 1 - (g.tick - g.lastEat) / rules.combo_window);
  const mult = rules.combo_mults[g.combo];
  const signalPct = Math.round((g.signal / rules.signal_max) * 100);
  const secs = (ticks: number) => Math.max(0, Math.ceil((ticks * g.tickMs()) / 1000));
  const active: { icon: string; label: string; left: number }[] = [];
  if (g.tick < g.boostUntil) active.push({ icon: "⚡", label: "Boost ×2", left: secs(g.boostUntil - g.tick) });
  if (g.tick < g.phaseUntil) active.push({ icon: "👻", label: "Phase", left: secs(g.phaseUntil - g.tick) });
  if (g.tick < g.magnetUntil) active.push({ icon: "🧲", label: "Magnet", left: secs(g.magnetUntil - g.tick) });
  if (g.tick < g.slowUntil) active.push({ icon: "⏳", label: "Slow-mo", left: secs(g.slowUntil - g.tick) });
  const pauseKey = keyLabel(keysFor(GAME_ID, "pause", keys)[1] ?? "KeyP");

  return (
    <div className="snake-round">
      <div className="snake-hud panel" aria-live="off">
        <div className="wam-stat">
          <small>Score</small>
          <strong>{Math.trunc((g.s.raw * rules.size_pct[g.size]) / 100).toLocaleString()}</strong>
        </div>
        <div className="wam-stat">
          <small>Length</small>
          <strong>{g.snake.length}</strong>
        </div>
        <div className={`wam-stat snake-combo${mult > 1 ? " hot" : ""}`}>
          <small>Combo</small>
          <strong>×{mult * (g.tick < g.boostUntil ? 2 : 1)}</strong>
          <span className="snake-bar combo" aria-hidden="true">
            <span style={{ width: `${comboLeft * 100}%` }} />
          </span>
        </div>
        <div className={`wam-stat snake-signal${signalPct < 30 ? " low" : ""}`}>
          <small>📶 Signal</small>
          <strong>{signalPct}%</strong>
          <span
            className="snake-bar signal"
            role="progressbar"
            aria-label="Signal strength"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={signalPct}
          >
            <span style={{ width: `${signalPct}%` }} />
          </span>
        </div>
        <div className="snake-powers" aria-label="Active power-ups">
          {active.map((a) => (
            <span key={a.label} className="wam-power">
              {a.icon} {a.label} {a.left}s
            </span>
          ))}
        </div>
        <div className="wam-hud-btns">
          <button className="btn-ghost btn-sm" onClick={paused ? resume : pause} disabled={!countdown.done || g.over !== null}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            className="btn-ghost btn-sm"
            disabled={!countdown.done || g.over !== null}
            onClick={() => {
              pause();
              setConfirmEnd(true);
            }}
          >
            ⏹ End run
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="snake-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`Snake board, ${g.n} by ${g.n}. Length ${g.snake.length}, signal ${signalPct}%.`}
      >
        <canvas ref={canvasRef} />
        {pops.map((p) => (
          <span key={p.id} className={`snake-pop ${p.tone}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true">
            {p.text}
          </span>
        ))}
        {g.over !== null && g.over !== "quit" && (
          <div className="wam-overlay snake-ko" role="status">
            <strong>{END_TEXT[g.over]}</strong>
          </div>
        )}
        {confirmEnd ? (
          <div className="wam-overlay">
            <div className="wam-paused">
              <strong>End this run?</strong>
              <small>Your score so far still counts{g.mode === "daily" ? " (it's your one Daily try)" : ""}.</small>
              <div className="game-controls">
                <button className="btn-green" onClick={endRun}>
                  ⏹ End run
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

      {dpad && (
        <div className="snake-dpad" role="group" aria-label="Steer">
          {(
            [
              [0, "▲", "Up"],
              [3, "◀", "Left"],
              [1, "▶", "Right"],
              [2, "▼", "Down"],
            ] as [Dir, string, string][]
          ).map(([d, icon, label]) => (
            <button
              key={d}
              type="button"
              className={`snake-pad d${d}`}
              aria-label={label}
              onPointerDown={(e) => {
                e.preventDefault();
                steer(d);
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
      <p className="wam-hint snake-help">
        {dpad ? "Swipe on the board or use the arrows." : "Arrow keys / WASD, or swipe on the board."} {pauseKey} pauses.
      </p>
    </div>
  );
}
