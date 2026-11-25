/**
 * Brick Breaker rules. A line-for-line copy of
 * `backend/src/brick_breaker/engine.rs`: the server replays your paddle
 * inputs with the Rust version, so both must give identical results. Both read
 * `shared/brick_rules.json`, use only integer math (bounce directions come
 * from a table, no trig), and are checked against `shared/brick_vectors.json`.
 * Change both files together.
 *
 * The only extra here is `events`: what happened on the last tick, for sounds
 * and sparks. They never change the game.
 */
import RULES from "../../../../shared/brick_rules.json";
import { Rng } from "../../platform/seeded";

export const rules = RULES;

/** Integer division that truncates toward zero, like Rust's `/` on i32. */
const div = (a: number, b: number): number => Math.trunc(a / b);

export type Kind = "n" | "t" | "s" | "e";
export type Drop = "wide" | "multi" | "slow" | "life" | "laser" | "sticky";
/** In the order of `waves.drop_weights`. */
export const DROPS: Drop[] = ["wide", "multi", "slow", "life", "laser", "sticky"];
export type End = "clear" | "out" | "time" | "quit";

/** One brick in a layout: column, row, kind, hit points (tough), drop, and
 * for moving bricks `[min_col, max_col, speed]`. */
export interface BrickSpec {
  c: number;
  r: number;
  t: Kind;
  hp?: number;
  d?: Drop;
  m?: [number, number, number];
}

/** A hand-made Campaign level. */
export interface Level {
  id: number;
  name: string;
  speed?: number;
  bricks: BrickSpec[];
}

export interface Move {
  min_x: number;
  max_x: number;
  speed: number;
  dir: number;
}

export interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Kind;
  hp: number;
  max_hp: number;
  drop: Drop | null;
  mv: Move | null;
  alive: boolean;
}

export function build(specs: BrickSpec[]): Brick[] {
  const r = rules;
  return specs.map((s) => {
    const hp = s.t === "t" ? Math.min(3, Math.max(2, s.hp ?? 2)) : 1;
    return {
      x: s.c * r.brick_w,
      y: r.top + s.r * r.brick_h,
      w: r.brick_w,
      h: r.brick_h,
      kind: s.t,
      hp,
      max_hp: hp,
      drop: s.t === "s" ? null : (s.d ?? null),
      mv: s.m ? { min_x: s.m[0] * r.brick_w, max_x: s.m[1] * r.brick_w, speed: s.m[2], dir: 1 } : null,
      alive: true,
    };
  });
}

function pickDrop(rng: Rng): Drop {
  const w = rules.waves.drop_weights;
  const total = w.reduce((a, b) => a + b, 0);
  let x = rng.below(total);
  for (let i = 0; i < w.length; i++) {
    if (x < w[i]) return DROPS[i];
    x -= w[i];
  }
  return DROPS[0];
}

/** The wall for Endless / Daily wave `wave` (1-based). */
export function waveLayout(rng: Rng, wave: number): BrickSpec[] {
  const r = rules;
  const w = r.waves;
  const rows = Math.min(w.rows_start + Math.floor((wave - 1) / 2), w.rows_max);
  const toughPct = Math.min(w.tough_start + (wave - 1) * w.tough_step, w.tough_max);
  const steel = wave >= w.steel_from ? w.steel_pct : 0;
  const expl = steel + w.explosive_pct;
  const tough = expl + toughPct;
  const out: BrickSpec[] = [];
  for (let row = 0; row < rows; row++) {
    if (wave >= w.moving_from && row === rows - 1 && rng.below(2) === 0) {
      const half = r.cols / 2;
      for (let lane = 0; lane < 2; lane++) {
        const lo = lane * half;
        const t: Kind = rng.below(2) === 0 ? "t" : "n";
        const d = rng.below(100) < w.drop_chance ? pickDrop(rng) : undefined;
        const spec: BrickSpec = { c: lo, r: row, t, m: [lo, lo + half - 1, w.moving_speed] };
        if (t === "t") spec.hp = 2;
        if (d) spec.d = d;
        out.push(spec);
      }
      continue;
    }
    const pattern = rng.below(4);
    for (let c = 0; c < r.cols; c++) {
      let keep: boolean;
      if (pattern === 0) keep = true;
      else if (pattern === 1) keep = (c + row) % 2 === 0;
      else if (pattern === 2) keep = rng.below(5) !== 0;
      else keep = c >= 2 && c < r.cols - 2;
      if (!keep) continue;
      const roll = rng.below(100);
      const t: Kind = roll < steel ? "s" : roll < expl ? "e" : roll < tough ? "t" : "n";
      const spec: BrickSpec = { c, r: row, t };
      if (t === "t") spec.hp = wave >= w.tough3_from && rng.below(3) === 0 ? 3 : 2;
      if (t !== "s" && rng.below(100) < w.drop_chance) spec.d = pickDrop(rng);
      out.push(spec);
    }
  }
  if (!out.some((b) => b.t !== "s")) out.push({ c: r.cols / 2, r: 0, t: "n" });
  return out;
}

export interface Stuck {
  off: number;
  hold: number;
}
export interface Ball {
  x: number;
  y: number;
  a: number;
  sx: number;
  sy: number;
  stuck: Stuck | null;
  dead: boolean;
}
export interface Falling {
  kind: Drop;
  x: number;
  y: number;
}
export interface Bolt {
  x: number;
  y: number;
}

export interface Summary {
  score: number;
  bricks: number;
  cleared: boolean;
  stars: number;
  lives: number;
  wave: number;
  best_combo: number;
  best_chain: number;
  drops: number;
  lost: number;
  ticks: number;
  ended_by: End | null;
  game_ms: number;
}

/** What happened on the last tick (sounds and sparks only). */
export type GameEvent =
  | { type: "paddle"; x: number; y: number }
  | { type: "wall"; x: number; y: number }
  | { type: "hit"; x: number; y: number; kind: Kind }
  | { type: "break"; x: number; y: number; kind: Kind; combo: number }
  | { type: "explode"; x: number; y: number; chain: number }
  | { type: "catch"; drop: Drop; x: number }
  | { type: "fire" }
  | { type: "launch" }
  | { type: "lose"; lives: number }
  | { type: "wave"; wave: number }
  | { type: "clear" };

function overlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export class Game {
  rng: Rng;
  waves: boolean;
  tick = 0;
  bricks: Brick[];
  balls: Ball[] = [];
  drops: Falling[] = [];
  bolts: Bolt[] = [];
  paddle_x: number;
  target: number;
  lives: number;
  base_speed: number;
  speed: number;
  paddle_hits = 0;
  wide = 0;
  slow = 0;
  laser = 0;
  sticky = 0;
  cooldown = 0;
  combo = 0;
  stall = 0;
  over: End | null = null;
  s: Summary;
  events: GameEvent[] = [];

  /** A Campaign level, or Endless / Daily waves when `level` is null. */
  constructor(seed: number, level: Level | null) {
    const r = rules;
    this.rng = new Rng(seed);
    this.waves = level === null;
    if (level) {
      this.bricks = build(level.bricks);
      this.base_speed = level.speed ?? r.speed_start;
    } else {
      this.bricks = build(waveLayout(this.rng, 1));
      this.base_speed = r.speed_start;
    }
    this.speed = this.base_speed;
    this.paddle_x = r.width / 2;
    this.target = r.width / 2;
    this.lives = r.lives;
    this.s = {
      score: 0,
      bricks: 0,
      cleared: false,
      stars: 0,
      lives: r.lives,
      wave: 1,
      best_combo: 0,
      best_chain: 0,
      drops: 0,
      lost: 0,
      ticks: 0,
      ended_by: null,
      game_ms: 0,
    };
    this.serve();
  }

  paddleW(): number {
    return this.wide > 0 ? rules.paddle_wide_w : rules.paddle_w;
  }

  curSpeed(): number {
    return this.slow > 0 ? div(this.speed * rules.slow_pct, 100) : this.speed;
  }

  /** Velocity per tick of a free ball. */
  vel(b: Ball): [number, number] {
    const a = rules.angles[b.a];
    const sp = this.curSpeed();
    return [b.sx * div(a[0] * sp, 1000), b.sy * div(a[1] * sp, 1000)];
  }

  mult(): number {
    const r = rules;
    let m = r.combo_mults[0];
    for (let i = 0; i < r.combo_steps.length; i++) {
      if (this.combo >= r.combo_steps[i]) m = r.combo_mults[i];
    }
    return m;
  }

  private serve(): void {
    const r = rules;
    this.balls = [
      { x: this.paddle_x, y: r.paddle_y - r.ball_r, a: r.serve_angle, sx: 1, sy: -1, stuck: { off: 0, hold: r.serve_hold }, dead: false },
    ];
  }

  private clampPaddle(x: number): number {
    const half = div(this.paddleW(), 2);
    return Math.min(rules.width - half, Math.max(half, x));
  }

  private destroy(j: number): boolean {
    const r = rules;
    const b = this.bricks[j];
    b.alive = false;
    b.hp = 0;
    const cx = b.x + div(b.w, 2);
    const cy = b.y + div(b.h, 2);
    this.s.bricks += 1;
    this.stall = 0;
    this.combo += 1;
    this.s.best_combo = Math.max(this.s.best_combo, this.combo);
    let base = b.kind === "t" ? r.points.tough : b.kind === "e" ? r.points.explosive : r.points.normal;
    if (b.mv) base += r.points.moving_bonus;
    this.s.score += base * this.mult();
    if (b.drop) this.drops.push({ kind: b.drop, x: cx, y: cy });
    this.events.push({ type: "break", x: cx, y: cy, kind: b.kind, combo: this.combo });
    return b.kind === "e";
  }

  private explode(j: number): void {
    const queue = [j];
    let chain = 0;
    while (queue.length > 0) {
      const k = queue.shift() as number;
      const b = this.bricks[k];
      const ex = b.x - div(b.w, 2);
      const ey = b.y - div(b.h, 2);
      const ew = b.w * 2;
      const eh = b.h * 2;
      this.events.push({ type: "explode", x: b.x + div(b.w, 2), y: b.y + div(b.h, 2), chain });
      for (let m = 0; m < this.bricks.length; m++) {
        const o = this.bricks[m];
        if (!o.alive || o.kind === "s" || !overlap(ex, ey, ew, eh, o.x, o.y, o.w, o.h)) continue;
        chain += 1;
        if (this.destroy(m)) queue.push(m);
      }
    }
    this.s.best_chain = Math.max(this.s.best_chain, chain);
  }

  hitBrick(j: number): void {
    const b = this.bricks[j];
    if (b.kind === "s") {
      this.events.push({ type: "hit", x: b.x + div(b.w, 2), y: b.y + div(b.h, 2), kind: b.kind });
      return;
    }
    b.hp -= 1;
    if (b.hp === 0) {
      if (this.destroy(j)) this.explode(j);
    } else {
      this.s.score += rules.points.hit;
      this.events.push({ type: "hit", x: b.x + div(b.w, 2), y: b.y + div(b.h, 2), kind: b.kind });
    }
  }

  private touching(b: Ball): number[] {
    const rr = rules.ball_r;
    const out: number[] = [];
    for (let j = 0; j < this.bricks.length; j++) {
      const o = this.bricks[j];
      if (o.alive && overlap(b.x - rr, b.y - rr, rr * 2, rr * 2, o.x, o.y, o.w, o.h)) out.push(j);
    }
    return out;
  }

  private ballX(i: number, dx: number): void {
    if (dx === 0) return;
    const r = rules;
    const rr = r.ball_r;
    this.balls[i].x += dx;
    const b = this.balls[i];
    const bx = b.x;
    const hits = this.touching(b).filter((j) => {
      const cx = this.bricks[j].x + div(this.bricks[j].w, 2);
      return (dx > 0 && bx < cx) || (dx < 0 && bx > cx);
    });
    if (hits.length > 0) {
      if (dx > 0) {
        b.x = Math.min(...hits.map((j) => this.bricks[j].x)) - rr;
        b.sx = -1;
      } else {
        b.x = Math.max(...hits.map((j) => this.bricks[j].x + this.bricks[j].w)) + rr;
        b.sx = 1;
      }
      for (const j of hits) this.hitBrick(j);
    }
    if (b.x - rr < 0) {
      b.x = rr;
      b.sx = 1;
      this.events.push({ type: "wall", x: b.x, y: b.y });
    } else if (b.x + rr > r.width) {
      b.x = r.width - rr;
      b.sx = -1;
      this.events.push({ type: "wall", x: b.x, y: b.y });
    }
  }

  /** Moves ball `i` up or down; true when it got stuck on the paddle or fell out. */
  private ballY(i: number, dy: number): boolean {
    if (dy === 0) return false;
    const r = rules;
    const rr = r.ball_r;
    const b = this.balls[i];
    b.y += dy;
    const by = b.y;
    const hits = this.touching(b).filter((j) => {
      const cy = this.bricks[j].y + div(this.bricks[j].h, 2);
      return (dy > 0 && by < cy) || (dy < 0 && by > cy);
    });
    if (hits.length > 0) {
      if (dy > 0) {
        b.y = Math.min(...hits.map((j) => this.bricks[j].y)) - rr;
        b.sy = -1;
      } else {
        b.y = Math.max(...hits.map((j) => this.bricks[j].y + this.bricks[j].h)) + rr;
        b.sy = 1;
      }
      for (const j of hits) this.hitBrick(j);
    }
    if (b.y - rr < 0) {
      b.y = rr;
      b.sy = 1;
      this.events.push({ type: "wall", x: b.x, y: b.y });
    }
    const pw = this.paddleW();
    const px = this.paddle_x - div(pw, 2);
    if (dy > 0 && b.y <= r.paddle_y + div(r.paddle_h, 2) && overlap(b.x - rr, b.y - rr, rr * 2, rr * 2, px, r.paddle_y, pw, r.paddle_h)) {
      const off = b.x - this.paddle_x;
      const n = r.angles.length;
      const a = Math.min(n - 1, div(Math.abs(off) * n, div(pw, 2) + rr));
      const sx = off > 0 ? 1 : off < 0 ? -1 : b.sx;
      b.a = a;
      b.sx = sx;
      b.sy = -1;
      b.y = r.paddle_y - rr;
      this.combo = 0;
      this.stall = 0;
      this.paddle_hits += 1;
      if (this.paddle_hits % r.speed_every === 0) this.speed = Math.min(this.speed + r.speed_step, r.speed_max);
      this.events.push({ type: "paddle", x: b.x, y: b.y });
      if (this.sticky > 0) {
        const half = div(pw, 2);
        b.stuck = { off: Math.min(half, Math.max(-half, off)), hold: r.sticky_hold };
        return true;
      }
    }
    if (b.y - rr > r.height) {
      b.dead = true;
      return true;
    }
    return false;
  }

  private moveBall(i: number): void {
    const [vx0, vy0] = this.vel(this.balls[i]);
    const n = 1 + div(Math.max(Math.abs(vx0), Math.abs(vy0)), rules.max_step);
    for (let k = 0; k < n; k++) {
      const [vx, vy] = this.vel(this.balls[i]);
      const dx = div(vx * (k + 1), n) - div(vx * k, n);
      const dy = div(vy * (k + 1), n) - div(vy * k, n);
      this.ballX(i, dx);
      if (this.ballY(i, dy)) break;
    }
  }

  apply(d: Drop): void {
    const r = rules;
    this.s.drops += 1;
    this.s.score += r.drop_points;
    switch (d) {
      case "wide":
        this.wide = r.wide_ticks;
        break;
      case "slow":
        this.slow = r.slow_ticks;
        break;
      case "life":
        this.lives = Math.min(this.lives + 1, r.lives_max);
        break;
      case "laser":
        this.laser = r.laser_ticks;
        break;
      case "sticky":
        this.sticky = r.sticky_ticks;
        break;
      case "multi": {
        const src = this.balls.find((b) => b.stuck === null) ?? this.balls[0];
        if (src) {
          const b = { ...src };
          const top = r.angles.length - 1;
          const spawns: [number, number][] = [
            [Math.min(b.a + 2, top), b.sx],
            [Math.max(b.a - 2, 0), -b.sx],
          ];
          for (const [a, sx] of spawns) {
            if (this.balls.length < r.max_balls) {
              const sy = b.stuck !== null ? -1 : b.sy;
              this.balls.push({ x: b.x, y: b.y, a, sx, sy, stuck: null, dead: false });
            }
          }
        }
        break;
      }
    }
  }

  private loseLife(): void {
    this.s.lost += 1;
    this.lives -= 1;
    this.events.push({ type: "lose", lives: this.lives });
    if (this.lives === 0) {
      this.over = "out";
      return;
    }
    this.wide = 0;
    this.slow = 0;
    this.laser = 0;
    this.sticky = 0;
    this.cooldown = 0;
    this.drops = [];
    this.bolts = [];
    this.speed = this.base_speed;
    this.paddle_hits = 0;
    this.combo = 0;
    this.stall = 0;
    this.paddle_x = this.clampPaddle(this.paddle_x);
    this.serve();
  }

  private nextWave(): void {
    const r = rules;
    this.s.score += r.wave_bonus * this.s.wave;
    this.s.wave += 1;
    this.bricks = build(waveLayout(this.rng, this.s.wave));
    this.drops = [];
    this.bolts = [];
    this.base_speed = Math.min(r.speed_start + (this.s.wave - 1) * r.wave_speed_step, r.speed_max);
    this.speed = this.base_speed;
    this.paddle_hits = 0;
    this.combo = 0;
    this.stall = 0;
    this.serve();
    this.events.push({ type: "wave", wave: this.s.wave });
  }

  private finish(): void {
    this.s.ended_by = this.over;
    this.s.ticks = this.tick;
    this.s.game_ms = Math.floor((this.tick * 1000) / 60);
    this.s.lives = this.lives;
  }

  quit(): void {
    if (this.over === null) {
      this.over = "quit";
      this.finish();
    }
  }

  /** One tick. `target` = where the player wants the paddle (arena x). */
  step(target: number | null, launch: boolean, fire: boolean): void {
    this.events = [];
    if (this.over !== null) return;
    const r = rules;
    this.wide = Math.max(0, this.wide - 1);
    this.slow = Math.max(0, this.slow - 1);
    this.laser = Math.max(0, this.laser - 1);
    this.sticky = Math.max(0, this.sticky - 1);
    this.cooldown = Math.max(0, this.cooldown - 1);

    if (target !== null) this.target = target;
    const goal = this.clampPaddle(this.target);
    const d = Math.min(r.paddle_speed, Math.max(-r.paddle_speed, goal - this.paddle_x));
    this.paddle_x = this.clampPaddle(this.paddle_x + d);

    if (fire && this.laser > 0 && this.cooldown === 0) {
      const off = div(this.paddleW(), 2) - r.ball_r;
      this.bolts.push({ x: this.paddle_x - off, y: r.paddle_y });
      this.bolts.push({ x: this.paddle_x + off, y: r.paddle_y });
      this.cooldown = r.laser_cooldown;
      this.events.push({ type: "fire" });
    }

    for (const b of this.bricks) {
      const m = b.mv;
      if (b.alive && m) {
        b.x += m.dir * m.speed;
        if (b.x >= m.max_x) {
          b.x = m.max_x;
          m.dir = -1;
        } else if (b.x <= m.min_x) {
          b.x = m.min_x;
          m.dir = 1;
        }
      }
    }

    const half = div(this.paddleW(), 2);
    for (const b of this.balls) {
      const st = b.stuck;
      if (st) {
        st.off = Math.min(half, Math.max(-half, st.off));
        b.x = Math.min(r.width - r.ball_r, Math.max(r.ball_r, this.paddle_x + st.off));
        b.y = r.paddle_y - r.ball_r;
        st.hold = Math.max(0, st.hold - 1);
        if (launch || st.hold === 0) {
          b.stuck = null;
          this.events.push({ type: "launch" });
        }
      }
    }

    let free = false;
    for (let i = 0; i < this.balls.length; i++) {
      if (this.balls[i].stuck === null && !this.balls[i].dead) {
        free = true;
        this.moveBall(i);
      }
    }
    this.balls = this.balls.filter((b) => !b.dead);

    const pw = this.paddleW();
    const px = this.paddle_x - div(pw, 2);
    const caught: Drop[] = [];
    const kept: Falling[] = [];
    for (const dr of this.drops) {
      dr.y += r.drop_speed;
      if (overlap(dr.x - div(r.drop_w, 2), dr.y - div(r.drop_h, 2), r.drop_w, r.drop_h, px, r.paddle_y, pw, r.paddle_h)) {
        caught.push(dr.kind);
        this.events.push({ type: "catch", drop: dr.kind, x: dr.x });
        continue;
      }
      if (dr.y - div(r.drop_h, 2) <= r.height) kept.push(dr);
    }
    this.drops = kept;
    for (const c of caught) this.apply(c);

    let i = 0;
    while (i < this.bolts.length) {
      const bo = this.bolts[i];
      const ny = bo.y - r.laser_speed;
      const span = r.laser_speed + r.laser_h;
      let best: number | null = null;
      for (let j = 0; j < this.bricks.length; j++) {
        const o = this.bricks[j];
        if (o.alive && overlap(bo.x - div(r.laser_w, 2), ny, r.laser_w, span, o.x, o.y, o.w, o.h)) {
          if (best === null || o.y + o.h > this.bricks[best].y + this.bricks[best].h) best = j;
        }
      }
      if (best !== null) {
        this.hitBrick(best);
        this.bolts.splice(i, 1);
        continue;
      }
      if (ny + r.laser_h < 0) {
        this.bolts.splice(i, 1);
        continue;
      }
      bo.y = ny;
      i += 1;
    }

    if (free) {
      this.stall += 1;
      if (this.stall >= r.stall_ticks) {
        const top = r.angles.length - 1;
        for (const b of this.balls) if (b.stuck === null) b.a = b.a < top ? b.a + 1 : b.a - 1;
        this.stall = 0;
      }
    }

    if (!this.bricks.some((b) => b.alive && b.kind !== "s")) {
      if (this.waves) {
        this.nextWave();
      } else {
        this.s.cleared = true;
        this.s.stars = Math.min(this.lives, 3);
        this.s.score += r.clear_bonus + r.life_bonus * this.s.stars;
        this.over = "clear";
        this.events.push({ type: "clear" });
      }
    } else if (this.balls.length === 0) {
      this.loseLife();
    }

    this.tick += 1;
    if (this.over === null && this.tick >= r.max_ticks) this.over = "time";
    if (this.over !== null) this.finish();
  }
}

/** One input: at `tick`, a paddle target x (0..width) or an action. */
export type Input = [number, number];
export const LAUNCH = -1;
export const FIRE = -2;

export type ReplayError = "too_many_inputs" | "unsorted" | "bad_input" | "duplicate" | "after_end";

/** Plays a whole run, like the server does. */
export function replay(seed: number, level: Level | null, inputs: Input[], stopAt: number | null = null): Summary | ReplayError {
  const r = rules;
  if (inputs.length > r.max_inputs) return "too_many_inputs";
  for (let k = 1; k < inputs.length; k++) if (inputs[k][0] < inputs[k - 1][0]) return "unsorted";
  if (inputs.some(([, v]) => v < FIRE || v > r.width || !Number.isInteger(v))) return "bad_input";
  const g = new Game(seed, level);
  let i = 0;
  while (g.over === null) {
    if (stopAt !== null && g.tick >= stopAt) {
      g.quit();
      break;
    }
    let target: number | null = null;
    let launch = false;
    let fire = false;
    while (i < inputs.length && inputs[i][0] === g.tick) {
      const v = inputs[i][1];
      if (v === LAUNCH) {
        if (launch) return "duplicate";
        launch = true;
      } else if (v === FIRE) {
        if (fire) return "duplicate";
        fire = true;
      } else {
        if (target !== null) return "duplicate";
        target = v;
      }
      i += 1;
    }
    g.step(target, launch, fire);
  }
  if (i < inputs.length) return "after_end";
  return g.s;
}
