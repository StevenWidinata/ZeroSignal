/**
 * Snake Signal rules. A line-for-line copy of
 * `backend/src/snake_signal/engine.rs`: the server replays your turns with the
 * Rust version, so both must give identical results. Both read
 * `shared/snake_rules.json`, use only integer math, and are checked against
 * `shared/snake_vectors.json`. Change both files together.
 *
 * The only extra here is `events`: what happened on the last tick, for sounds
 * and sparks. They never change the game.
 */
import RULES from "../../../../shared/snake_rules.json";
import { Rng } from "../../platform/seeded";

export const rules = RULES;

export type Mode = "classic" | "wrap" | "daily";
export const MODES: Mode[] = ["classic", "wrap", "daily"];
export type Size = "small" | "medium" | "large";
export const SIZES: Size[] = ["small", "medium", "large"];
export type Power = "boost" | "phase" | "magnet" | "slow" | "snip";
export const POWERS: Power[] = ["boost", "phase", "magnet", "slow", "snip"];
export type End = "wall" | "self" | "glitch" | "bug" | "signal" | "full" | "time" | "quit";
/** 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;

/** `scores.level` of each mode's leaderboard. */
export const BOARD_ID: Record<Mode, number> = { classic: 1, wrap: 2, daily: 4 };

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface Block {
  cell: number;
  born: number;
}
export interface Bug {
  cell: number;
  born: number;
}
export interface Golden {
  cell: number;
  until: number;
}
export interface PowerItem {
  kind: Power;
  cell: number;
  until: number;
}

export interface Summary {
  score: number;
  raw: number;
  length: number;
  max_length: number;
  eaten: number;
  golden: number;
  powers: number;
  close_calls: number;
  bugs_eaten: number;
  best_combo: number;
  ticks: number;
  game_ms: number;
  ended_by: End | null;
}

export type SnakeEvent =
  | { type: "food"; cell: number; points: number }
  | { type: "golden"; cell: number; points: number }
  | { type: "power"; cell: number; kind: Power }
  | { type: "bug_eaten"; cell: number; points: number }
  | { type: "close_call"; points: number }
  | { type: "combo"; mult: number }
  | { type: "hazard" }
  | { type: "bug_spawn" }
  | { type: "crash"; why: End };

export const sizeN = (s: Size): number => RULES.sizes[s];
export const sizePct = (s: Size): number => RULES.size_pct[s];
export const wraps = (m: Mode): boolean => m === "wrap";

export class Game {
  readonly mode: Mode;
  readonly size: Size;
  readonly n: number;
  private rng: Rng;
  /** Head first. */
  snake: number[] = [];
  /** How many snake parts sit on each cell (Phase lets them overlap). */
  private occ: number[];
  dir: Dir = 1;
  private grow = 0;
  food = 0;
  golden: Golden | null = null;
  power: PowerItem | null = null;
  blocks: Block[] = [];
  bug: Bug | null = null;
  boostUntil = 0;
  phaseUntil = 0;
  magnetUntil = 0;
  slowUntil = 0;
  signal: number;
  /** Index into `combo_mults`. */
  combo = 0;
  lastEat: number | null = null;
  private lastClose: number | null = null;
  tick = 0;
  over: End | null = null;
  s: Summary;
  /** What happened on the last tick (for sounds and sparks only). */
  events: SnakeEvent[] = [];

  constructor(seed: number, mode: Mode, size: Size) {
    const r = RULES;
    this.mode = mode;
    this.size = size;
    const n = sizeN(size);
    this.n = n;
    this.rng = new Rng(seed);
    const mid = Math.trunc(n / 2);
    this.occ = new Array<number>(n * n).fill(0);
    for (let i = 0; i < r.start_len; i++) {
      const c = mid * n + (mid - i);
      this.snake.push(c);
      this.occ[c] += 1;
    }
    this.signal = r.signal_max;
    this.s = {
      score: 0,
      raw: 0,
      length: r.start_len,
      max_length: r.start_len,
      eaten: 0,
      golden: 0,
      powers: 0,
      close_calls: 0,
      bugs_eaten: 0,
      best_combo: 1,
      ticks: 0,
      game_ms: 0,
      ended_by: null,
    };
    const f = this.pickFree(2);
    if (f === null) throw new Error("an empty board has room");
    this.food = f;
  }

  head(): number {
    return this.snake[0];
  }

  /** Length of the current tick in ms (gets faster as you grow). */
  tickMs(): number {
    const r = RULES;
    const grown = this.snake.length - Math.min(r.start_len, this.snake.length);
    const base = Math.max(Math.max(0, r.tick_start_ms - grown * r.tick_step_ms), r.tick_min_ms);
    return this.tick < this.slowUntil ? Math.trunc((base * r.slow_pct) / 100) : base;
  }

  /** Current points multiplier (combo × Boost). */
  mult(): number {
    return RULES.combo_mults[this.combo] * (this.tick < this.boostUntil ? 2 : 1);
  }

  xy(c: number): [number, number] {
    return [c % this.n, Math.trunc(c / this.n)];
  }

  /** The cell one step from `c` in `dir`; null = through a wall. */
  next(c: number, dir: number): number | null {
    const n = this.n;
    const [x, y] = this.xy(c);
    let nx = x + DX[dir];
    let ny = y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) {
      if (!wraps(this.mode)) return null;
      nx = (nx + n) % n;
      ny = (ny + n) % n;
    }
    return ny * n + nx;
  }

  private cheb(a: number, b: number): number {
    const [ax, ay] = this.xy(a);
    const [bx, by] = this.xy(b);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  /** A glitch block that is solid right now (after its warning flicker). */
  solidAt(c: number): boolean {
    const w = RULES.hazard_warn;
    return this.blocks.some((b) => b.cell === c && this.tick >= b.born + w);
  }

  /** Would moving the head into this cell end the run? */
  deadly(c: number | null): boolean {
    if (c === null) return true;
    if (this.solidAt(c)) return true;
    if (this.bug !== null && this.bug.cell === c && this.tick >= this.boostUntil) return true;
    const tail = this.snake[this.snake.length - 1];
    const leaving = c === tail && this.grow === 0 && this.occ[c] === 1;
    return this.occ[c] > 0 && !leaving && this.tick >= this.phaseUntil;
  }

  /** Number of snake parts on a cell. */
  occupied(c: number): number {
    return this.occ[c];
  }

  /** Empty for spawning: no snake, block, item or bug there. */
  private free(c: number): boolean {
    return (
      this.occ[c] === 0 &&
      c !== this.food &&
      !this.blocks.some((b) => b.cell === c) &&
      !(this.golden !== null && this.golden.cell === c) &&
      !(this.power !== null && this.power.cell === c) &&
      !(this.bug !== null && this.bug.cell === c)
    );
  }

  /** A random free cell at least `away` (Chebyshev) from the head. */
  private pickFree(away: number): number | null {
    const head = this.head();
    const total = this.n * this.n;
    let count = 0;
    for (let c = 0; c < total; c++) if (this.free(c) && this.cheb(c, head) >= away) count++;
    if (count === 0) return null;
    let k = this.rng.below(count);
    for (let c = 0; c < total; c++) {
      if (this.free(c) && this.cheb(c, head) >= away) {
        if (k === 0) return c;
        k--;
      }
    }
    return null;
  }

  private end(why: End): void {
    this.over = why;
    this.tick += 1;
    this.s.ticks = this.tick;
    this.s.length = this.snake.length;
    this.s.ended_by = why;
    this.s.score = Math.trunc((this.s.raw * sizePct(this.size)) / 100);
    this.events.push({ type: "crash", why });
  }

  /** End the run now (the player stopped); points so far count. */
  quit(): void {
    if (this.over !== null) return;
    this.over = "quit";
    this.s.ticks = this.tick;
    this.s.length = this.snake.length;
    this.s.ended_by = "quit";
    this.s.score = Math.trunc((this.s.raw * sizePct(this.size)) / 100);
  }

  private addPoints(base: number): number {
    const p = base * this.mult();
    this.s.raw += p;
    return p;
  }

  /** Eating food or a golden packet keeps the combo chain going. */
  private chain(): void {
    const r = RULES;
    const t = this.tick;
    const before = this.combo;
    this.combo =
      this.lastEat !== null && t - this.lastEat <= r.combo_window ? Math.min(this.combo + 1, r.combo_mults.length - 1) : 0;
    this.lastEat = t;
    this.s.best_combo = Math.max(this.s.best_combo, r.combo_mults[this.combo]);
    if (this.combo > before) this.events.push({ type: "combo", mult: r.combo_mults[this.combo] });
  }

  /**
   * One tick. `turn` (if any) must not be the current direction or its
   * reverse; `replay` rejects those.
   */
  step(turn: Dir | null): void {
    this.events = [];
    if (this.over !== null) return;
    const r = RULES;
    const t = this.tick;
    this.s.game_ms += this.tickMs();

    // Things that run out.
    if (this.golden !== null && this.golden.until <= t) this.golden = null;
    if (this.power !== null && this.power.until <= t) this.power = null;
    this.blocks = this.blocks.filter((b) => t < b.born + r.hazard_warn + r.hazard_life);
    if (this.bug !== null && this.bug.born + r.bug_life <= t) this.bug = null;
    if (this.lastEat !== null && t - this.lastEat > r.combo_window) this.combo = 0;

    const old = this.dir;
    if (turn !== null) this.dir = turn;
    const head = this.head();

    // Close call: you turned away one step before something deadly.
    if (
      turn !== null &&
      this.deadly(this.next(head, old)) &&
      (this.lastClose === null || t - this.lastClose >= r.close_call_gap)
    ) {
      const points = this.addPoints(r.close_call_points);
      this.s.close_calls += 1;
      this.lastClose = t;
      this.events.push({ type: "close_call", points });
    }

    const c = this.next(head, this.dir);
    if (c === null) return this.end("wall");
    if (this.solidAt(c)) return this.end("glitch");
    if (this.bug !== null && this.bug.cell === c) {
      if (t < this.boostUntil) {
        this.bug = null;
        const points = this.addPoints(r.bug_points);
        this.s.bugs_eaten += 1;
        this.events.push({ type: "bug_eaten", cell: c, points });
      } else {
        return this.end("bug");
      }
    }
    const tail = this.snake[this.snake.length - 1];
    const leaving = c === tail && this.grow === 0 && this.occ[c] === 1;
    if (this.occ[c] > 0 && !leaving && t >= this.phaseUntil) return this.end("self");

    // Move.
    const lenBefore = this.snake.length;
    this.snake.unshift(c);
    this.occ[c] += 1;
    if (this.grow > 0) {
      this.grow -= 1;
    } else {
      const gone = this.snake.pop() as number;
      this.occ[gone] -= 1;
    }

    // Magnet pulls the food one cell closer.
    if (t < this.magnetUntil && this.food !== c) {
      const [hx, hy] = this.xy(c);
      const [fx, fy] = this.xy(this.food);
      const dx = hx - fx;
      const dy = hy - fy;
      if (Math.abs(dx) + Math.abs(dy) <= r.magnet_range) {
        const [mx, my] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        const to = (fy + my) * this.n + fx + mx;
        if (to === c || this.free(to)) this.food = to;
      }
    }

    // Eat.
    if (c === this.food) {
      this.chain();
      const level = Math.min(Math.trunc((lenBefore - Math.min(r.start_len, lenBefore)) / r.level_every), r.level_max);
      const points = this.addPoints(r.food_base + level * r.food_per_level);
      this.events.push({ type: "food", cell: c, points });
      this.s.eaten += 1;
      this.grow += 1;
      this.signal = Math.min(this.signal + r.signal_food, r.signal_max);
      const f = this.pickFree(0);
      if (f === null) return this.end("full");
      this.food = f;
      if (this.golden === null && this.rng.below(r.golden_chance) === 0) {
        const g = this.pickFree(0);
        if (g !== null) this.golden = { cell: g, until: t + 1 + r.golden_ticks };
      }
      if (this.power === null && this.s.eaten % r.power_every === 0) {
        const kind = POWERS[this.rng.below(POWERS.length)];
        const p = this.pickFree(0);
        if (p !== null) this.power = { kind, cell: p, until: t + 1 + r.power_ticks };
      }
    }
    if (this.golden !== null && this.golden.cell === c) {
      this.golden = null;
      this.chain();
      const points = this.addPoints(r.golden_points);
      this.events.push({ type: "golden", cell: c, points });
      this.s.golden += 1;
      this.grow += r.golden_grow;
      this.signal = Math.min(this.signal + r.signal_golden, r.signal_max);
    }
    if (this.power !== null && this.power.cell === c) {
      const p = this.power;
      this.power = null;
      this.s.powers += 1;
      this.events.push({ type: "power", cell: c, kind: p.kind });
      const until = t + 1;
      switch (p.kind) {
        case "boost":
          this.boostUntil = until + r.boost_ticks;
          break;
        case "phase":
          this.phaseUntil = until + r.phase_ticks;
          break;
        case "magnet":
          this.magnetUntil = until + r.magnet_ticks;
          break;
        case "slow":
          this.slowUntil = until + r.slow_ticks;
          break;
        case "snip": {
          const keep = Math.max(Math.trunc(this.snake.length / 2), r.start_len);
          while (this.snake.length > keep) {
            const gone = this.snake.pop() as number;
            this.occ[gone] -= 1;
          }
          this.grow = 0;
          this.addPoints(r.snip_points);
          break;
        }
      }
    }
    this.s.max_length = Math.max(this.s.max_length, this.snake.length);

    // Glitch blocks: a short line appears away from the head.
    if (t >= r.hazard_start && (t - r.hazard_start) % r.hazard_every === 0 && this.blocks.length < r.hazard_max) {
      const first = this.pickFree(r.hazard_safe);
      if (first !== null) {
        const len = 1 + this.rng.below(3);
        const dir = this.rng.below(2) === 0 ? 1 : 2;
        let cell: number | null = first;
        for (let i = 0; i < len; i++) {
          if (cell === null) break;
          const b: number = cell;
          if (this.blocks.length >= r.hazard_max || !this.free(b) || this.cheb(b, c) < r.hazard_safe) break;
          this.blocks.push({ cell: b, born: t });
          const [x, y] = this.xy(b);
          cell = (dir === 1 && x + 1 < this.n) || (dir === 2 && y + 1 < this.n) ? y * this.n + x + DX[dir] + DY[dir] * this.n : null;
        }
        this.events.push({ type: "hazard" });
      }
    }

    // The glitch bug: appears now and then and wanders around.
    if (this.bug === null && t >= r.bug_start && (t - r.bug_start) % r.bug_every === 0) {
      const b = this.pickFree(r.bug_safe);
      if (b !== null) {
        this.bug = { cell: b, born: t };
        this.events.push({ type: "bug_spawn" });
      }
    } else if (this.bug !== null) {
      const bug = this.bug;
      if ((t - bug.born) % r.bug_step === r.bug_step - 1) {
        const start = this.rng.below(4);
        const [x, y] = this.xy(bug.cell);
        for (let k = 0; k < 4; k++) {
          const d = (start + k) % 4;
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= this.n || ny >= this.n) continue;
          const to = ny * this.n + nx;
          if (this.free(to)) {
            this.bug = { cell: to, born: bug.born };
            break;
          }
        }
      }
    }

    // Signal drains every tick; food refills it.
    this.signal -= r.signal_drain;
    if (this.signal <= 0) {
      this.signal = 0;
      return this.end("signal");
    }

    this.tick += 1;
    this.s.ticks = this.tick;
    this.s.length = this.snake.length;
    if (this.tick >= r.max_ticks) {
      this.tick -= 1;
      this.end("time");
    }
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** One turn: at `tick`, start heading `dir`. */
export type Turn = [tick: number, dir: Dir];

export type ReplayError = "too_many_turns" | "unsorted" | "bad_dir" | "bad_turn" | "after_end";

/** Is `d` a real turn from `cur` (not straight on, not a U-turn)? */
export const canTurn = (cur: Dir, d: Dir): boolean => d !== cur && d !== (cur + 2) % 4;

/**
 * Plays a whole run; the run always ends (crash, signal lost or time cap),
 * or at tick `stopAt` if the player quit there.
 */
export function replay(seed: number, mode: Mode, size: Size, turns: Turn[], stopAt: number | null = null): Summary | ReplayError {
  if (turns.length > RULES.max_ticks) return "too_many_turns";
  for (let i = 1; i < turns.length; i++) if (turns[i][0] <= turns[i - 1][0]) return "unsorted";
  if (turns.some((t) => t[1] > 3 || t[1] < 0)) return "bad_dir";
  const g = new Game(seed, mode, size);
  let i = 0;
  while (g.over === null) {
    if (stopAt !== null && g.tick >= stopAt) {
      g.quit();
      break;
    }
    let turn: Dir | null = null;
    if (i < turns.length && turns[i][0] === g.tick) {
      const d = turns[i][1];
      i++;
      if (!canTurn(g.dir, d)) return "bad_turn";
      turn = d;
    }
    g.step(turn);
  }
  if (i < turns.length) return "after_end";
  return g.s;
}
