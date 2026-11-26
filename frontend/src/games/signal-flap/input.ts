/**
 * One-button controls: a click, tap or key press flaps on the next tick.
 * Every tick this turns presses into the engine's one input, and logs the
 * ticks it flapped on for the server. Pure logic (no window/store imports) so
 * it can be unit-tested.
 */
import { actionFor, type KeyOverrides } from "../../platform/keymap";
import type { Game } from "./engine";

export const GAME_ID = "signal-flap";

export class FlapControl {
  /** A press not yet used. Several presses within one tick are one flap. */
  private pressed = false;
  /** The ticks the drone flapped on. */
  readonly log: number[] = [];

  press(): void {
    this.pressed = true;
  }

  /** Forgets a press not yet used (pause, lost focus). */
  reset(): void {
    this.pressed = false;
  }

  /** Whether to flap on the coming tick of `g`; logs it. */
  next(g: Game): boolean {
    const flap = this.pressed && g.over === null;
    this.pressed = false;
    if (flap) this.log.push(g.tick);
    return flap;
  }
}

export type KeyAction = "flap" | "pause";

/** The action for a key (respects rebinding in Settings → Controls). */
export function actionForKey(code: string, overrides: KeyOverrides): KeyAction | null {
  const a = actionFor(GAME_ID, code, overrides);
  return a === "flap" || a === "pause" ? a : null;
}
