/**
 * Echo Rally rules. A line-for-line copy of
 * `backend/src/echo_rally/engine.rs`: the server replays your matches against
 * Zero-Bot with the Rust version, so both must give identical results. Both
 * read `shared/rally_rules.json`, use only integer math, and are checked
 * against `shared/rally_vectors.json`. Change both files together.
 *
 * Side 0 is the left paddle, side 1 the right. Each point starts with a serve
 * toward the player who lost the last one. Every return makes the ball a
 * little faster, and where it meets the paddle sets the angle back. First to
 * the target wins. In Chaos each side brings a kit of powers and can fire
 * each one once per match.
 *
 * The only extra here is `events`: what happened on the last tick, for sounds
 * and sparks. They never change the game.
 */
import RULES from "../../../../shared/rally_rules.json";
import { Rng } from "../../platform/seeded";

export const rules = RULES;

/** Integer division that truncates toward zero, like Rust's `/` on i32. */
export const div = (a: number, b: number): number => Math.trunc(a / b);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
/** -1, 0 or 1 (never -0). */
export const signum = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export type Side = 0 | 1;

/** The x of the paddle's front face on `side`. */
export const faceX = (side: number): number =>
  side === 0 ? rules.pad_inset + rules.pad_w : rules.width - rules.pad_inset - rules.pad_w;
/** The x of the ball's centre when it touches `side`'s paddle face. */
export const contactX = (side: number): number => (side === 0 ? faceX(0) + rules.ball_r : faceX(1) - rules.ball_r);
/** The steepest angle index. */
export const lastAngle = (): number => rules.cos.length - 1;

// ---------------------------------------------------------------------------
// Powers
// ---------------------------------------------------------------------------

export type Power = "grow" | "shrink" | "smash" | "shield" | "echo" | "curve" | "freeze" | "multi-ball" | "ghost" | "fog";
export const POWERS = rules.power_ids as Power[];

/** A Chaos kit is fine: `kit_size` different powers. */
export const kitOk = (kit: Power[]): boolean =>
  kit.length === rules.kit_size && kit.every((p, i) => POWERS.includes(p) && !kit.slice(0, i).includes(p));

// ---------------------------------------------------------------------------
// Court
// ---------------------------------------------------------------------------

export interface Paddle {
  /** Centre. */
  y: number;
  /** Where it is heading (the player's last input). */
  target: number;
  score: number;
  kit: Power[];
  used: boolean[];
  /** Ticks left on timed effects. `shrink`, `freeze` and `fog` are put on this paddle by the rival. */
  grow: number;
  shrink: number;
  freeze: number;
  shield: number;
  echo: number;
  fog: number;
  /** Armed for this paddle's next return. */
  smash: boolean;
  curve: boolean;
  ghost: boolean;
}

function newPaddle(kit: Power[]): Paddle {
  const r = rules;
  return {
    y: div(r.height, 2),
    target: div(r.height, 2),
    score: 0,
    kit: [...kit],
    used: kit.map(() => false),
    grow: 0,
    shrink: 0,
    freeze: 0,
    shield: 0,
    echo: 0,
    fog: 0,
    smash: false,
    curve: false,
    ghost: false,
  };
}

/** Current height (Grow and Shrink change it). */
export function padH(p: Paddle): number {
  const r = rules;
  let h = r.pad_h;
  if (p.grow > 0) h = div(h * r.powers.grow_pct, 100);
  if (p.shrink > 0) h = div(h * r.powers.shrink_pct, 100);
  return h;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The rally speed (grows with every return). */
  speed: number;
  /** This flight's speed (the rally speed, or more after a Smash). */
  flight: number;
  /** Who hit it last. */
  owner: number | null;
  /** Curve: bends once it crosses the net. */
  curve: boolean;
  bend: number;
  bend_ticks: number;
  /** Ghost: invisible across the middle third. */
  ghost: boolean;
}

/** Hidden by Ghost right now? */
export const hidden = (b: Ball): boolean => {
  const w = rules.width;
  return b.ghost && b.x > div(w, 3) && b.x < div(2 * w, 3);
};

export type End = "win" | "time" | "quit";

export interface Summary {
  score: [number, number];
  winner: number | null;
  ended_by: End | null;
  ticks: number;
  game_ms: number;
  /** Returns by each side. */
  hits: [number, number];
  /** Most returns (both sides) in one point. */
  longest_rally: number;
  /** Powers fired by each side. */
  powers: [number, number];
}

/** One side's input for one tick. */
export interface Control {
  /** A new paddle target (centre y). */
  target: number | null;
  /** Fire kit slot 0, 1 or 2. */
  fire: number | null;
}
export const NO_INPUT: Control = { target: null, fire: null };

export type GameEvent =
  | { type: "serve" }
  | { type: "hit"; side: number; speed: number; x: number; y: number }
  | { type: "wall" }
  | { type: "shield"; side: number; y: number }
  | { type: "point"; side: number }
  | { type: "fire"; side: number; power: Power }
  | { type: "over"; winner: number | null };

/** Where a ball will be (its centre y) when it reaches `x`, bouncing off the
 *  top and bottom walls; its current y if it is moving away. */
export function predictY(b: Ball, x: number): number {
  const r = rules;
  const dx = x - b.x;
  if (b.vx === 0 || dx > 0 !== b.vx > 0) return b.y;
  const raw = b.y + div(b.vy * dx, b.vx);
  const span = r.height - 2 * r.ball_r;
  let p = (raw - r.ball_r) % (2 * span);
  if (p < 0) p += 2 * span;
  if (p > span) p = 2 * span - p;
  return p + r.ball_r;
}

export class Game {
  rng: Rng;
  tick = 0;
  /** Points to win. */
  target: number;
  pads: [Paddle, Paddle];
  balls: Ball[] = [];
  /** Ticks until the next serve (0 = in play). */
  serve_wait: number;
  /** The side the next serve flies toward. */
  serve_to: number;
  /** Ticks left on Multi-ball. */
  multi = 0;
  /** Returns in the current point. */
  rally = 0;
  over: End | null = null;
  s: Summary = {
    score: [0, 0],
    winner: null,
    ended_by: null,
    ticks: 0,
    game_ms: 0,
    hits: [0, 0],
    longest_rally: 0,
    powers: [0, 0],
  };
  /** What happened on the last tick (sounds and sparks only). */
  events: GameEvent[] = [];

  /** A new match to `target` points. `kits` are empty in Classic. */
  constructor(seed: number, target: number, kits: [Power[], Power[]]) {
    this.rng = new Rng(seed);
    this.serve_to = this.rng.below(2);
    this.target = target;
    this.pads = [newPaddle(kits[0]), newPaddle(kits[1])];
    this.serve_wait = rules.serve_delay;
  }

  /** Points played so far. */
  points(): number {
    return this.s.score[0] + this.s.score[1];
  }

  /** Can `side` fire kit slot `slot` now? */
  canFire(side: number, slot: number): boolean {
    const p = this.pads[side];
    return this.over === null && slot < p.kit.length && !p.used[slot];
  }

  /** A copy of `b` going the other way up or down (Multi-ball). */
  private static mirror(b: Ball): Ball {
    const r = rules;
    const m = { ...b };
    if (b.vy === 0) m.vy = div(b.flight * r.sin[3], 1000);
    else m.vy = -b.vy;
    return m;
  }

  private fire(side: number, slot: number): void {
    if (!this.canFire(side, slot)) return;
    const pr = rules.powers;
    const q = 1 - side;
    const me = this.pads[side];
    const them = this.pads[q];
    me.used[slot] = true;
    this.s.powers[side] += 1;
    const power = me.kit[slot];
    this.events.push({ type: "fire", side, power });
    switch (power) {
      case "grow":
        me.grow = pr.grow_ticks;
        break;
      case "shrink":
        them.shrink = pr.shrink_ticks;
        break;
      case "smash":
        me.smash = true;
        break;
      case "shield":
        me.shield = pr.shield_ticks;
        break;
      case "echo":
        me.echo = pr.echo_ticks;
        break;
      case "curve":
        me.curve = true;
        break;
      case "freeze":
        them.freeze = pr.freeze_ticks;
        break;
      case "multi-ball":
        this.multi = pr.multi_ticks;
        if (this.balls.length === 1) {
          const m = Game.mirror(this.balls[0]);
          if (this.balls[0].vy === 0) this.balls[0].vy = -m.vy;
          this.balls.push(m);
        }
        break;
      case "ghost":
        me.ghost = true;
        break;
      case "fog":
        them.fog = pr.fog_ticks;
        break;
    }
  }

  private launch(): void {
    const r = rules;
    const a = this.rng.below(2 * r.serve_angle + 1) - r.serve_angle;
    const i = Math.abs(a);
    const dir = this.serve_to === 0 ? -1 : 1;
    const flight = r.speed_start;
    const b: Ball = {
      x: div(r.width, 2),
      y: div(r.height, 2),
      vx: dir * div(flight * r.cos[i], 1000),
      vy: signum(a) * div(flight * r.sin[i], 1000),
      speed: flight,
      flight,
      owner: null,
      curve: false,
      bend: 0,
      bend_ticks: 0,
      ghost: false,
    };
    if (this.multi > 0) {
      const m = Game.mirror(b);
      if (b.vy === 0) b.vy = -m.vy;
      this.balls.push(b, m);
    } else {
      this.balls.push(b);
    }
    this.events.push({ type: "serve" });
  }

  /** The paddle on `side` meets the ball at height `cy` (if it reaches). */
  private tryHit(side: number, b: Ball, cy: number): boolean {
    const r = rules;
    const pr = r.powers;
    const pad = this.pads[side];
    const reach = div(padH(pad), 2) + r.ball_r;
    const rel = cy - pad.y;
    if (Math.abs(rel) > reach) return false;
    const last = lastAngle();
    const idx = clamp(div(rel * last, reach), -last, last);
    b.x = contactX(side);
    b.y = clamp(cy, r.ball_r, r.height - r.ball_r);
    b.speed = Math.min(b.speed + r.speed_step, r.speed_max);
    let flight = b.speed;
    if (pad.smash) {
      flight = Math.min(div(flight * pr.smash_pct, 100), pr.smash_max);
      pad.smash = false;
    }
    b.flight = flight;
    const a = Math.abs(idx);
    const dir = side === 0 ? 1 : -1;
    b.vx = dir * Math.max(div(flight * r.cos[a], 1000), 1);
    b.vy = signum(idx) * div(flight * r.sin[a], 1000);
    b.owner = side;
    b.bend = 0;
    b.bend_ticks = 0;
    b.curve = pad.curve;
    pad.curve = false;
    b.ghost = pad.ghost;
    pad.ghost = false;
    this.rally += 1;
    this.s.hits[side] += 1;
    this.s.longest_rally = Math.max(this.s.longest_rally, this.rally);
    this.events.push({ type: "hit", side, speed: flight, x: b.x, y: b.y });
    return true;
  }

  /** Moves ball `i` one tick; returns the side that scored, if it got past. */
  private moveBall(i: number): number | null {
    const r = rules;
    const pr = r.powers;
    const rad = r.ball_r;
    const b = this.balls[i];
    if (b.bend_ticks > 0) {
      b.vy += b.bend;
      b.bend_ticks -= 1;
      const lim = div(b.flight * r.sin[lastAngle()], 1000);
      b.vy = clamp(b.vy, -lim, lim);
    }
    const px = b.x;
    const py = b.y;
    b.x += b.vx;
    b.y += b.vy;
    if (b.y - rad < 0) {
      b.y = 2 * rad - b.y;
      b.vy = -b.vy;
      this.events.push({ type: "wall" });
    } else if (b.y + rad > r.height) {
      b.y = 2 * (r.height - rad) - b.y;
      b.vy = -b.vy;
      this.events.push({ type: "wall" });
    }
    const mid = div(r.width, 2);
    if (b.curve && px < mid !== b.x < mid) {
      b.curve = false;
      b.bend = b.vy > 0 ? -pr.curve_acc : pr.curve_acc;
      b.bend_ticks = pr.curve_ticks;
    }
    if (b.vx < 0) {
      const face = faceX(0);
      if (px - rad >= face && b.x - rad < face) {
        const cy = py + div((b.y - py) * (px - rad - face), px - b.x);
        this.tryHit(0, b, cy);
      }
    } else {
      const face = faceX(1);
      if (px + rad <= face && b.x + rad > face) {
        const cy = py + div((b.y - py) * (face - px - rad), b.x - px);
        this.tryHit(1, b, cy);
      }
    }
    if (b.vx < 0 && this.pads[0].shield > 0 && b.x - rad < pr.shield_w) {
      b.x = pr.shield_w + rad;
      b.vx = -b.vx;
      this.pads[0].shield = 0;
      this.events.push({ type: "shield", side: 0, y: b.y });
    } else if (b.vx > 0 && this.pads[1].shield > 0 && b.x + rad > r.width - pr.shield_w) {
      b.x = r.width - pr.shield_w - rad;
      b.vx = -b.vx;
      this.pads[1].shield = 0;
      this.events.push({ type: "shield", side: 1, y: b.y });
    }
    if (b.x + rad < 0) return 1;
    if (b.x - rad > r.width) return 0;
    return null;
  }

  private scorePoint(side: number): void {
    const r = rules;
    this.pads[side].score += 1;
    this.s.score[side] += 1;
    this.balls = [];
    this.multi = 0;
    this.rally = 0;
    this.serve_to = 1 - side;
    this.serve_wait = r.serve_delay;
    this.events.push({ type: "point", side });
    if (this.pads[side].score >= this.target) {
      this.over = "win";
      this.s.winner = side;
    }
  }

  private finish(): void {
    this.s.ended_by = this.over;
    this.s.ticks = this.tick;
    this.s.game_ms = div(this.tick * 1000, 60);
    this.events.push({ type: "over", winner: this.s.winner });
  }

  /** `side` leaves: the other side wins. */
  quit(side: number): void {
    if (this.over === null) {
      this.over = "quit";
      this.s.winner = 1 - side;
      this.finish();
    }
  }

  /** One tick with both sides' inputs. */
  step(ctl: [Control, Control]): void {
    this.events = [];
    if (this.over !== null) return;
    const r = rules;
    for (let side = 0; side < 2; side++) {
      const c = ctl[side];
      if (c.fire !== null) this.fire(side, c.fire);
      if (c.target !== null) this.pads[side].target = clamp(c.target, 0, r.height);
    }
    for (const p of this.pads) {
      p.grow = Math.max(p.grow - 1, 0);
      p.shrink = Math.max(p.shrink - 1, 0);
      p.freeze = Math.max(p.freeze - 1, 0);
      p.shield = Math.max(p.shield - 1, 0);
      p.echo = Math.max(p.echo - 1, 0);
      p.fog = Math.max(p.fog - 1, 0);
    }
    if (this.multi > 0) {
      this.multi -= 1;
      if (this.multi === 0 && this.balls.length > 1) this.balls.length = 1;
    }
    for (const p of this.pads) {
      const h = padH(p);
      if (p.freeze === 0) p.y += clamp(p.target - p.y, -r.pad_speed, r.pad_speed);
      p.y = clamp(p.y, div(h, 2), r.height - div(h, 2));
    }
    if (this.serve_wait > 0) {
      this.serve_wait -= 1;
      if (this.serve_wait === 0) this.launch();
    }
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const side = this.moveBall(i);
      if (side !== null) {
        this.scorePoint(side);
        break;
      }
    }
    this.tick += 1;
    if (this.over === null && this.tick >= r.max_ticks) {
      this.over = "time";
      const [a, b] = this.s.score;
      this.s.winner = a > b ? 0 : b > a ? 1 : null;
    }
    if (this.over !== null) this.finish();
  }
}

/** One input: at `tick`, either a paddle target y (0..=height) or a power
 *  fire (-1 = slot 0, -2 = slot 1, -3 = slot 2). */
export type Input = [number, number];
export const FIRE_0 = -1;
