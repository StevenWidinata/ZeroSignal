/**
 * Paddle controls: the mouse or a finger points the paddle at a height, keys
 * and the phone buttons slide it up and down, and 1/2/3 (or the power
 * buttons) fire a kit slot. Every tick this turns what the player is doing
 * into the engine's input, and only real changes get logged for the server.
 * Pure logic (no window/store imports) so it can be unit-tested.
 */
import { actionFor, type KeyOverrides } from "../../platform/keymap";
import { FIRE_0, rules, type Control, type Game, type Input } from "./engine";

export const GAME_ID = "echo-rally";

/** Court y for a spot on the board (0..1 down), on the 100-unit grid. */
export function courtY(frac: number): number {
  const y = Math.round((Math.min(1, Math.max(0, frac)) * rules.height) / 100) * 100;
  return Math.min(rules.height, Math.max(0, y));
}

export class RallyControl {
  /** Keys or buttons held down. */
  up = false;
  down = false;
  /** Where the mouse or finger last pointed, not yet used. */
  private pointer: number | null = null;
  /** Kit slots asked for, oldest first (one fires per tick). */
  private fires: number[] = [];
  /** A slide key was held on the last tick. */
  private sliding = false;
  /** Everything fed to the engine that changed something. */
  readonly log: Input[] = [];

  constructor(private side = 0) {}

  point(y: number): void {
    this.pointer = y;
  }

  fire(slot: number): void {
    if (!this.fires.includes(slot)) this.fires.push(slot);
  }

  /** Lets go of everything (pause, lost focus). */
  reset(): void {
    this.up = false;
    this.down = false;
    this.pointer = null;
    this.fires = [];
  }

  /** The input for the coming tick of `g`; logs it and returns it. */
  next(g: Game): Control {
    const pad = g.pads[this.side];
    let want: number | null = null;
    const slide = this.up !== this.down;
    if (slide) {
      want = this.up ? 0 : rules.height;
      this.pointer = null;
    } else if (this.sliding) {
      // Let go of the key: stop where the paddle is now.
      want = courtY(pad.y / rules.height);
    } else if (this.pointer !== null) {
      want = this.pointer;
    }
    this.sliding = slide;
    this.pointer = null;
    const target = want !== null && want !== pad.target ? want : null;

    let fire: number | null = null;
    while (this.fires.length > 0 && fire === null) {
      const slot = this.fires.shift()!;
      if (g.canFire(this.side, slot)) fire = slot;
    }

    if (target !== null) this.log.push([g.tick, target]);
    if (fire !== null) this.log.push([g.tick, FIRE_0 - fire]);
    return { target, fire };
  }
}

export type KeyAction = "up" | "down" | "power1" | "power2" | "power3" | "pause";

/** The action for a key (respects rebinding in Settings → Controls). */
export function actionForKey(code: string, overrides: KeyOverrides): KeyAction | null {
  const a = actionFor(GAME_ID, code, overrides);
  return a === "up" || a === "down" || a === "power1" || a === "power2" || a === "power3" || a === "pause" ? a : null;
}
