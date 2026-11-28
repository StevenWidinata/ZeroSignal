/**
 * Zero-Bot for Echo Rally. A line-for-line copy of
 * `backend/src/echo_rally/bot.rs`: it only looks at the court (as a player
 * would) and uses its own seeded random numbers, so a match against it
 * replays exactly from the seed and the player's inputs. Change both together.
 *
 * For every new shot coming its way it waits a few ticks (its reaction),
 * picks an aiming error, and moves its paddle toward where the ball will
 * arrive, at its own top speed. Better levels react sooner, err less, move
 * faster and hit off-centre on purpose to send the ball at an angle. It can't
 * see a Ghost ball across the middle, or anything in Fog, and Echo takes its
 * error away. In Chaos, Easy and Medium fire their powers at random moments;
 * Hard and Master wait for a good moment.
 */
import { Rng } from "../../platform/seeded";
import { clamp, contactX, div, hidden, padH, POWERS, predictY, rules, type Ball, type Control, type Game, type Power } from "./engine";

const KIT_SALT = 0x4b49_5421;
const BOT_SALT = 0x424f_5452;
/** Ticks a smart bot waits between two powers. */
const COOLDOWN = 240;

/** The powers Zero-Bot brings at `level` (Echo never: it doesn't need it). */
export function botKit(seed: number, level: number): Power[] {
  const n = rules.bot[level].powers;
  const pool = POWERS.filter((p) => p !== "echo");
  const rng = new Rng((seed ^ KIT_SALT) >>> 0);
  const out: Power[] = [];
  while (out.length < n) {
    const p = pool[rng.below(pool.length)];
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export class Bot {
  side: number;
  level: number;
  private rng: Rng;
  /** Where it thinks the ball will arrive. */
  private plan: number;
  /** The shot it is reacting to (points x 1000 + returns). */
  private shot: number | null = null;
  private react = 0;
  private err = 0;
  private aim = 0;
  /** Easy and Medium: [point, ticks into it] to fire each kit slot. */
  private moments: [number, number][] = [];
  private pointsSeen = 0;
  private pointStart = 0;
  private cooldown = 0;

  constructor(seed: number, side: number, level: number, g: Game) {
    const lv = rules.bot[level];
    this.side = side;
    this.level = level;
    this.rng = new Rng((seed ^ BOT_SALT ^ side) >>> 0);
    this.plan = div(rules.height, 2);
    if (!lv.smart) {
      for (let k = 0; k < g.pads[side].kit.length; k++) {
        const point = this.rng.below(Math.max(g.target, 1));
        const ticks = 60 + this.rng.below(480);
        this.moments.push([point, ticks]);
      }
    }
  }

  /** The nearest ball flying toward `side`'s paddle. */
  static nearest(g: Game, side: number): Ball | null {
    const x = contactX(side);
    let best: Ball | null = null;
    for (const b of g.balls) {
      const toward = side === 0 ? b.vx < 0 : b.vx > 0;
      if (toward && (best === null || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
    }
    return best;
  }

  private sees(g: Game, b: Ball): boolean {
    const r = rules;
    if (hidden(b)) return false;
    if (g.pads[this.side].fog > 0) {
      const clear = r.powers.fog_clear;
      const near = this.side === 0 ? b.x < clear : b.x > r.width - clear;
      if (!near) return false;
    }
    return true;
  }

  control(g: Game): Control {
    const r = rules;
    const lv = r.bot[this.level];
    const me = g.pads[this.side];
    const rival = g.pads[1 - this.side];
    if (g.points() !== this.pointsSeen) {
      this.pointsSeen = g.points();
      this.pointStart = g.tick;
    }
    this.cooldown = Math.max(this.cooldown - 1, 0);
    let desired = me.y;
    const b = Bot.nearest(g, this.side);
    if (b !== null) {
      const shot = g.points() * 1000 + g.rally;
      if (this.shot !== shot) {
        this.shot = shot;
        this.react = lv.react;
        // The faster the ball, the bigger the error.
        const range = div(lv.error * b.flight, 1000);
        this.err = range > 0 ? this.rng.below(2 * range + 1) - range : 0;
        this.aim = 0;
        if (lv.aim_pct > 0) {
          const pct = div(lv.aim_pct, 2) + this.rng.below(div(lv.aim_pct, 2) + 1);
          const mag = div(div(padH(me), 2) * pct, 100);
          // Master sends it away from the rival; Hard picks a side.
          const down = this.level === 3 ? rival.y < div(r.height, 2) : this.rng.below(2) === 0;
          this.aim = down ? mag : -mag;
        }
      }
      if (this.sees(g, b)) this.plan = predictY(b, contactX(this.side));
      if (this.react > 0) {
        this.react -= 1;
      } else {
        const err = me.echo > 0 ? 0 : this.err;
        desired = this.plan + err - this.aim;
      }
    } else if (lv.center) {
      desired = div(r.height, 2);
    }
    const max = div(r.pad_speed * lv.speed_pct, 100);
    const target = clamp(me.y + clamp(desired - me.y, -max, max), 0, r.height);
    const fire = this.pickFire(g);
    return { target, fire };
  }

  private pickFire(g: Game): number | null {
    const r = rules;
    const lv = r.bot[this.level];
    const me = g.pads[this.side];
    if (me.kit.length === 0 || g.over !== null) return null;
    if (!lv.smart) {
      const pts = g.points();
      for (let k = 0; k < this.moments.length; k++) {
        const [point, ticks] = this.moments[k];
        if (!me.used[k] && (pts > point || (pts === point && g.tick - this.pointStart >= ticks))) return k;
      }
      return null;
    }
    if (this.cooldown > 0) return null;
    const rs = 1 - this.side;
    const rival = g.pads[rs];
    const rx = contactX(rs);
    const inc = Bot.nearest(g, this.side);
    const out = Bot.nearest(g, rs);
    for (let k = 0; k < me.kit.length; k++) {
      if (me.used[k]) continue;
      let ok: boolean;
      switch (me.kit[k]) {
        case "grow":
        case "shield":
        case "echo":
          ok = inc !== null && (inc.flight >= 800 || rival.score + 1 >= g.target);
          break;
        case "smash":
        case "curve":
        case "ghost":
          ok = inc !== null && g.rally >= 2;
          break;
        case "shrink":
        case "multi-ball":
          ok = out !== null && Math.abs(out.x - rx) < div(r.width, 2);
          break;
        case "freeze":
          ok =
            out !== null &&
            Math.abs(out.x - rx) < div(r.width * 3, 10) &&
            Math.abs(predictY(out, rx) - rival.y) > div(padH(rival), 2);
          break;
        case "fog":
          ok = out !== null && Math.abs(out.x - rx) > div(r.width, 2);
          break;
      }
      if (ok) {
        // Hard hesitates; Master fires at once.
        if (this.level < 3 && this.rng.below(100) >= 4) return null;
        this.cooldown = COOLDOWN;
        return k;
      }
    }
    return null;
  }
}
