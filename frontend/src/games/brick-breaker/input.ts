/**
 * Paddle controls: the mouse or a finger points the paddle at a spot, keys
 * and the phone buttons slide it, Space / Launch launches a held ball and
 * fires the laser. Every tick this turns what the player is doing into the
 * engine's three inputs, and only real changes get logged for the server.
 * Pure logic (no window/store imports) so it can be unit-tested.
 */
import { actionFor, type KeyOverrides } from "../../platform/keymap";
import { FIRE, LAUNCH, rules, type Game, type Input } from "./engine";

export const GAME_ID = "brick-breaker";

/** Arena x for a spot on the board (0..1 across), on the 100-unit grid. */
export function arenaX(frac: number): number {
  const x = Math.round((Math.min(1, Math.max(0, frac)) * rules.width) / 100) * 100;
  return Math.min(rules.width, Math.max(0, x));
}

export class PaddleControl {
  /** Keys or buttons held down. */
  left = false;
  right = false;
  /** The action key / button is held (keeps the laser firing). */
  held = false;
  /** A press not yet used (launches a held ball). */
  private pressed = false;
  /** Where the mouse or finger last pointed, not yet used. */
  private pointer: number | null = null;
  /** A slide key was held on the last tick. */
  private sliding = false;
  /** Everything fed to the engine that changed something. */
  readonly log: Input[] = [];

  point(x: number): void {
    this.pointer = x;
  }

  press(): void {
    this.pressed = true;
    this.held = true;
  }

  release(): void {
    this.held = false;
  }

  /** Lets go of everything (pause, lost focus). */
  reset(): void {
    this.left = false;
    this.right = false;
    this.held = false;
    this.pressed = false;
  }

  /** Inputs for the coming tick of `g`; logs them and returns them. */
  next(g: Game): { target: number | null; launch: boolean; fire: boolean } {
    let want: number | null = null;
    const slide = this.left !== this.right;
    if (slide) {
      want = this.left ? 0 : rules.width;
      this.pointer = null;
    } else if (this.sliding) {
      // Let go of the key: stop where the paddle is now.
      want = arenaX(g.paddle_x / rules.width);
    } else if (this.pointer !== null) {
      want = this.pointer;
    }
    this.sliding = slide;
    this.pointer = null;
    const target = want !== null && want !== g.target ? want : null;

    const stuck = g.balls.some((b) => b.stuck !== null);
    const launch = this.pressed && stuck;
    const fire = (this.pressed || this.held) && g.laser > 0 && g.cooldown === 0;
    this.pressed = false;

    if (target !== null) this.log.push([g.tick, target]);
    if (launch) this.log.push([g.tick, LAUNCH]);
    if (fire) this.log.push([g.tick, FIRE]);
    return { target, launch, fire };
  }
}

export type KeyAction = "left" | "right" | "launch" | "pause";

/** The action for a key (respects rebinding in Settings → Controls). */
export function actionForKey(code: string, overrides: KeyOverrides): KeyAction | null {
  const a = actionFor(GAME_ID, code, overrides);
  return a === "left" || a === "right" || a === "launch" || a === "pause" ? a : null;
}
