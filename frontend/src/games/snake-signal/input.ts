/**
 * Steering: keys, swipes and the D-pad all feed a small turn queue, so two
 * quick presses between ticks (e.g. up then left to make a tight U) both
 * count. Pure logic (no window/store imports) so it can be unit-tested.
 */
import { actionFor, type KeyOverrides } from "../../platform/keymap";
import { canTurn, type Dir } from "./engine";

export const GAME_ID = "snake-signal";
/** Turns waiting for the next ticks. */
export const MAX_QUEUED = 2;

export class TurnQueue {
  private q: Dir[] = [];

  /** Queue a turn; ignored if it's straight on / a U-turn from the last queued one. */
  push(d: Dir, current: Dir): boolean {
    const last = this.q.length > 0 ? this.q[this.q.length - 1] : current;
    if (!canTurn(last, d) || this.q.length >= MAX_QUEUED) return false;
    this.q.push(d);
    return true;
  }

  /** The next turn that is still legal from `current`. */
  take(current: Dir): Dir | null {
    while (this.q.length > 0) {
      const d = this.q.shift() as Dir;
      if (canTurn(current, d)) return d;
    }
    return null;
  }

  clear(): void {
    this.q = [];
  }

  get size(): number {
    return this.q.length;
  }
}

const ACTION_DIR: Record<string, Dir> = { up: 0, right: 1, down: 2, left: 3 };

/** Direction for a key (respects rebinding in Settings → Controls). */
export function dirForKey(code: string, overrides: KeyOverrides): Dir | null {
  const a = actionFor(GAME_ID, code, overrides);
  return a !== null && a in ACTION_DIR ? ACTION_DIR[a] : null;
}

export function isPauseKey(code: string, overrides: KeyOverrides): boolean {
  return actionFor(GAME_ID, code, overrides) === "pause";
}

/** A swipe of at least `min` px → a direction. */
export function swipeToDir(dx: number, dy: number, min = 24): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}
