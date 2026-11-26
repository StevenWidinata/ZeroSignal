/**
 * Signal Flap rules. A line-for-line copy of
 * `backend/src/signal_flap/engine.rs`: the server replays your flaps with the
 * Rust version, so both must give identical results. Both read
 * `shared/flap_rules.json`, use only integer math, and are checked against
 * `shared/flap_vectors.json`. Change both files together.
 *
 * The drone stays at a fixed x; the towers scroll left. It hovers until the
 * first flap, which starts the course. One touch of a tower, the ground or the
 * ceiling ends the run. Score = gaps passed + signal bars picked up.
 *
 * The only extra here is `events`: what happened on the last tick, for sounds
 * and sparks. They never change the game.
 */
import RULES from "../../../../shared/flap_rules.json";
import { Rng } from "../../platform/seeded";

export const rules = RULES;

/** Integer division that truncates toward zero, like Rust's `/` on i32. */
const div = (a: number, b: number): number => Math.trunc(a / b);
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The top of the ground strip. */
export const groundY = (): number => rules.height - rules.ground_h;

export type End = "crash" | "time" | "quit";

/** One antenna tower pair with a gap between the top and bottom parts. */
export interface Tower {
  /** 0-based count from the start of the course. */
  idx: number;
  /** Left edge. */
  x: number;
  /** Gap height. */
  gap: number;
  /** Gap centre when not moving. */
  center: number;
  /** How far a moving gap slides from its centre (0 = still). */
  amp: number;
  off: number;
  dir: number;
  mspeed: number;
  passed: boolean;
}

export const gapY = (t: Tower): number => t.center + t.off;
export const gapTop = (t: Tower): number => gapY(t) - div(t.gap, 2);
export const gapBot = (t: Tower): number => gapY(t) + div(t.gap, 2);

/** A signal bar to pick up (centre point). */
export interface Bar {
  x: number;
  y: number;
}

export interface Summary {
  /** Gaps + bars. */
  score: number;
  gaps: number;
  bars: number;
  flaps: number;
  ticks: number;
  ended_by: End | null;
  game_ms: number;
}

export type GameEvent =
  | { type: "flap" }
  | { type: "pass"; gaps: number }
  | { type: "bar"; x: number; y: number }
  | { type: "crash" };

/** Does a circle at (cx, cy) touch the rectangle? */
function touches(cx: number, cy: number, cr: number, x: number, y: number, w: number, h: number): boolean {
  const px = clamp(cx, x, x + w);
  const py = clamp(cy, y, y + h);
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy < cr * cr;
}

export class Game {
  rng: Rng;
  tick = 0;
  /** False until the first flap; nothing moves before it. */
  started = false;
  y: number;
  vy = 0;
  speed: number;
  towers: Tower[] = [];
  bars: Bar[] = [];
  /** Where the next tower will be placed. */
  next_x: number;
  next_idx = 0;
  /** The gap centre of the last tower placed. */
  last_center: number;
  over: End | null = null;
  s: Summary = { score: 0, gaps: 0, bars: 0, flaps: 0, ticks: 0, ended_by: null, game_ms: 0 };
  /** What happened on the last tick (sounds and sparks only). */
  events: GameEvent[] = [];

  constructor(seed: number) {
    const r = rules;
    this.rng = new Rng(seed);
    this.y = r.start_y;
    this.speed = r.speed_start;
    this.next_x = r.first_x;
    this.last_center = r.start_y;
    this.spawn();
  }

  /** Places towers until one is waiting just past the right edge. */
  private spawn(): void {
    const r = rules;
    while (this.next_x <= r.width + r.spacing) this.addTower();
  }

  private addTower(): void {
    const r = rules;
    const m = r.moving;
    const idx = this.next_idx;
    const gap = Math.max(r.gap_start - idx * r.gap_step, r.gap_min);
    const half = div(gap, 2);
    // Always the same 7 draws per tower, so both engines stay in step.
    const dCenter = this.rng.nextU32();
    const dMove = this.rng.below(100);
    const dAmp = this.rng.nextU32();
    const dSpeed = this.rng.nextU32();
    const dDir = this.rng.below(2);
    const dBar = this.rng.below(100);
    const dOff = this.rng.nextU32();

    const pct = idx >= m.from ? Math.min(m.pct_start + (idx - m.from) * m.pct_step, m.pct_max) : 0;
    const moving = dMove < pct;
    const amp = moving ? m.amp_min + (dAmp % (m.amp_max - m.amp_min + 1)) : 0;
    const mspeed = moving ? m.speed_min + (dSpeed % (m.speed_max - m.speed_min + 1)) : 0;
    const dir = dDir === 0 ? 1 : -1;

    const ground = groundY();
    const low = r.margin + half + amp;
    const high = ground - r.margin - half - amp;
    const lo = Math.max(low, this.last_center - r.max_shift);
    const hi = Math.min(high, this.last_center + r.max_shift);
    const center = hi >= lo ? lo + (dCenter % (hi - lo + 1)) : clamp(this.last_center, low, high);

    if (idx >= 1 && dBar < r.bars.pct) {
      const x = this.next_x - div(r.spacing, 2) + div(r.tower_w, 2);
      const mid = div(this.last_center + center, 2);
      const off = (dOff % (2 * r.bars.spread + 1)) - r.bars.spread;
      const y = clamp(mid + off, r.margin, ground - r.margin);
      this.bars.push({ x, y });
    }

    this.towers.push({ idx, x: this.next_x, gap, center, amp, off: 0, dir, mspeed, passed: false });
    this.last_center = center;
    this.next_x += r.spacing;
    this.next_idx += 1;
  }

  private hitsTower(t: Tower): boolean {
    const r = rules;
    const top = gapTop(t);
    const bot = gapBot(t);
    return (
      touches(r.drone_x, this.y, r.drone_r, t.x, 0, r.tower_w, top) ||
      touches(r.drone_x, this.y, r.drone_r, t.x, bot, r.tower_w, groundY() - bot)
    );
  }

  private finish(): void {
    this.s.ended_by = this.over;
    this.s.ticks = this.tick;
    this.s.game_ms = div(this.tick * 1000, 60);
  }

  quit(): void {
    if (this.over === null) {
      this.over = "quit";
      this.finish();
    }
  }

  /** One tick; `flap` = the player pressed the button on this tick. */
  step(flap: boolean): void {
    this.events = [];
    if (this.over !== null) return;
    const r = rules;
    if (flap) {
      this.started = true;
      this.vy = r.flap_v;
      this.s.flaps += 1;
      this.events.push({ type: "flap" });
    }
    if (this.started) {
      this.vy = Math.min(this.vy + r.gravity, r.max_fall);
      this.y += this.vy;

      const sp = this.speed;
      for (const t of this.towers) {
        t.x -= sp;
        if (t.amp > 0) {
          t.off += t.dir * t.mspeed;
          if (t.off >= t.amp) {
            t.off = t.amp;
            t.dir = -1;
          } else if (t.off <= -t.amp) {
            t.off = -t.amp;
            t.dir = 1;
          }
        }
      }
      for (const b of this.bars) b.x -= sp;
      this.next_x -= sp;
      this.towers = this.towers.filter((t) => t.x + r.tower_w >= 0);
      this.bars = this.bars.filter((b) => b.x + r.bars.r >= 0);
      this.spawn();

      for (const t of this.towers) {
        if (!t.passed && t.x + r.tower_w < r.drone_x) {
          t.passed = true;
          this.s.gaps += 1;
          this.s.score += 1;
          this.events.push({ type: "pass", gaps: this.s.gaps });
        }
      }
      this.speed = Math.min(r.speed_start + div(this.s.gaps, r.speed_every) * r.speed_step, r.speed_max);

      const reach = r.drone_r + r.bars.r;
      const y = this.y;
      const kept: Bar[] = [];
      for (const b of this.bars) {
        const dx = b.x - r.drone_x;
        const dy = b.y - y;
        if (dx * dx + dy * dy > reach * reach) kept.push(b);
        else this.events.push({ type: "bar", x: b.x, y: b.y });
      }
      const got = this.bars.length - kept.length;
      this.bars = kept;
      this.s.bars += got;
      this.s.score += got;

      if (this.y - r.drone_r <= 0 || this.y + r.drone_r >= groundY() || this.towers.some((t) => this.hitsTower(t))) {
        this.over = "crash";
        this.events.push({ type: "crash" });
      }
    }
    this.tick += 1;
    if (this.over === null && this.tick >= r.max_ticks) this.over = "time";
    if (this.over !== null) this.finish();
  }
}

export type ReplayError = "too_many_inputs" | "unsorted" | "duplicate" | "bad_input" | "after_end";

/** Plays a whole run from the ticks the player flapped on, like the server. */
export function replay(seed: number, flaps: number[], stopAt: number | null = null): Summary | ReplayError {
  const r = rules;
  if (flaps.length > r.max_inputs) return "too_many_inputs";
  // The server only accepts whole, non-negative ticks (its JSON type is u32).
  if (flaps.some((t) => !Number.isInteger(t) || t < 0)) return "bad_input";
  for (let k = 1; k < flaps.length; k++) {
    if (flaps[k] === flaps[k - 1]) return "duplicate";
    if (flaps[k] < flaps[k - 1]) return "unsorted";
  }
  const g = new Game(seed);
  let i = 0;
  while (g.over === null) {
    if (stopAt !== null && g.tick >= stopAt) {
      g.quit();
      break;
    }
    const flap = i < flaps.length && flaps[i] === g.tick;
    if (flap) i += 1;
    g.step(flap);
  }
  if (i < flaps.length) return "after_end";
  return g.s;
}
