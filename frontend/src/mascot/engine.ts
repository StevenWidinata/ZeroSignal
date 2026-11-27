import { CLICK_LINES, DIZZY_LINES, JOKES, MOPE_LINES, PET_LINES } from "./lines";
import { headY, isUpsideDown, type Particle, type PingState, type Pose } from "./sprite";

/**
 * Ping's behaviour, with no DOM: idles on his own, reacts to clicks, gets dizzy
 * when poked fast and enjoys being petted. The React side feeds it time and
 * input and draws whatever `state()` says.
 */

export type PingSfx = "batFlap" | "batPong" | "batChirp" | "batYawn";

export interface Reaction {
  line?: string;
  sfx?: PingSfx;
}

/** Seconds each pose lasts. */
export const DURATION: Record<Pose, number> = {
  hang: 5,
  ping: 2.4,
  echo: 1.8,
  stretch: 2.4,
  flap: 1.1,
  flip: 0.9,
  nap: 30,
  dizzy: 1.8,
  mope: 4,
  look: 2.6,
};

export const IDLES: Pose[] = ["hang", "ping", "stretch", "look"];
export const TRICKS: Pose[] = ["flap", "flip", "echo"];

/** Pokes this close together make him dizzy. */
export const DIZZY_POKES = 5;
export const DIZZY_WINDOW_MS = 2500;
/** Holding this long turns a press into petting. */
export const PET_HOLD_MS = 420;
/** Seconds between idles. */
export const IDLE_GAP: [number, number] = [6, 12];

export interface BrainOptions {
  random?: () => number;
  /** Always play this pose (for static places like tutorials); no idles or tricks. */
  fixed?: Pose | null;
}

export class PingBrain {
  t = 0;
  pose: Pose | null = null;
  at = 0;
  dur = 0;
  look: -1 | 0 | 1 = 0;
  hoverLook: -1 | 0 | 1 | null = null;
  petting = false;
  night = false;
  hanging = false;
  /** Low mood: his resting pose is a mope (wings wrapped, ears down). */
  moping = false;
  /** Being dragged around (or flying home): upright and flapping. */
  carried = false;
  particles: Particle[] = [];

  private next: number;
  private blinkIn: number;
  private blinkLeft = 0;
  private pokes: number[] = [];
  private lastTrick: Pose | null = null;
  private lastIdle: Pose | null = null;
  private petClock = 0;
  private rnd: () => number;
  private fixed: Pose | null;

  constructor(opts: BrainOptions = {}) {
    this.rnd = opts.random ?? Math.random;
    this.fixed = opts.fixed ?? null;
    this.next = this.between(2, 4);
    this.blinkIn = this.between(1.5, 4);
    if (this.fixed) this.play(this.fixed);
  }

  private between(a: number, b: number) {
    return a + this.rnd() * (b - a);
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rnd() * list.length) % list.length];
  }

  play(pose: Pose, dur = DURATION[pose]) {
    this.pose = pose;
    this.at = 0;
    this.dur = dur;
  }

  /** Advance time. `still`: reduced motion, so no idles start on their own. */
  update(dt: number, still = false) {
    this.t += dt;

    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.14;
      this.blinkIn = this.between(2.5, 5.5);
    }
    if (this.blinkLeft > 0) this.blinkLeft -= dt;

    if (this.fixed) {
      this.at += dt;
      if (this.at >= this.dur) this.at = 0;
    } else if (this.pose) {
      this.at += dt;
      if (this.at >= this.dur) {
        this.pose = null;
        this.next = this.between(...IDLE_GAP);
      }
    } else if (!this.petting && !still) {
      this.next -= dt;
      if (this.next <= 0) this.idle();
    }

    if (this.pose === "look") this.look = this.at < 0.8 ? -1 : this.at < 1.7 ? 1 : 0;
    else this.look = this.hoverLook ?? 0;

    if (this.petting) {
      this.petClock += dt;
      if (this.petClock >= 0.35) {
        this.petClock = 0;
        const st = this.state();
        // Upside down, hearts rise beside him instead of across his body.
        const x = isUpsideDown(st) ? (this.rnd() < 0.5 ? this.between(0, 6) : this.between(35, 41)) : 20 + this.between(-8, 8);
        this.spawn("heart", x, headY(st), this.between(-3, 3), -12, 1.2);
      }
    }
    if (this.pose === "nap" && this.everyZ(dt)) this.spawn("z", 30, 4, 6, -8, 2.2);

    for (const q of this.particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  private zClock = 0;
  private everyZ(dt: number) {
    this.zClock += dt;
    if (this.zClock < 0.9) return false;
    this.zClock = 0;
    return true;
  }

  spawn(glyph: Particle["glyph"], x: number, y: number, vx: number, vy: number, life: number) {
    this.particles.push({ glyph, x, y, vx, vy, life, max: life });
  }

  /** Start an idle (a given one, or a random one that isn't the last). */
  idle(pose?: Pose) {
    const p = pose ?? this.pick(IDLES.filter((n) => n !== this.lastIdle));
    this.lastIdle = p;
    this.play(p);
  }

  /** A click or tap. `nowMs` is a wall-clock time in ms; `still` = reduced motion (talks, no tricks). */
  click(nowMs: number, still = false): Reaction {
    if (this.fixed || this.carried || this.pose === "dizzy") return {};
    if (still) return { line: this.pick(this.moping ? MOPE_LINES : JOKES), sfx: "batChirp" };
    this.pokes = this.pokes.filter((t) => nowMs - t < DIZZY_WINDOW_MS);
    this.pokes.push(nowMs);
    if (this.pokes.length >= DIZZY_POKES) {
      this.pokes = [];
      this.play("dizzy");
      return { line: this.pick(DIZZY_LINES), sfx: "batChirp" };
    }
    const trick = this.pick(TRICKS.filter((n) => n !== this.lastTrick));
    this.lastTrick = trick;
    this.play(trick);
    if (this.moping) return { line: this.pick(MOPE_LINES), sfx: "batChirp" };
    if (trick === "echo") return { line: CLICK_LINES.echo, sfx: "batPong" };
    if (trick === "flap") return { line: CLICK_LINES.flap, sfx: "batFlap" };
    return { line: this.pick(JOKES), sfx: "batFlap" };
  }

  /** Picked up (true) or back on his bar (false). */
  carry(on: boolean) {
    this.carried = on;
    if (on) {
      this.pose = null;
      this.petting = false;
    } else {
      this.next = this.between(...IDLE_GAP);
    }
  }

  startPet() {
    if (this.fixed || this.carried) return;
    this.petting = true;
    this.pose = null;
    this.petClock = 0.3;
  }

  stopPet(): Reaction {
    if (!this.petting) return {};
    this.petting = false;
    this.next = this.between(...IDLE_GAP);
    return { line: this.pick(PET_LINES), sfx: "batChirp" };
  }

  state(): PingState {
    if (this.carried)
      return {
        t: this.t,
        pose: "flap",
        at: this.t,
        k: (this.t * 1.4) % 1,
        blink: false,
        look: 0,
        petting: false,
        night: this.night,
        hanging: false,
      };
    const resting = !this.pose && this.moping && !this.petting;
    return {
      t: this.t,
      pose: resting ? "mope" : this.pose,
      at: resting ? this.t : this.at,
      k: this.dur ? Math.min(1, this.at / this.dur) : 0,
      blink: this.blinkLeft > 0,
      look: this.look,
      petting: this.petting,
      night: this.night,
      hanging: this.hanging,
    };
  }
}
