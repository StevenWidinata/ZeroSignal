import { describe, expect, it } from "vitest";
import { TurnQueue, dirForKey, isPauseKey, swipeToDir } from "./input";
import { ARENAS, SKINS, TRAILS, itemName } from "./items";

describe("turn queue", () => {
  it("keeps two quick turns for a tight U", () => {
    const q = new TurnQueue();
    // Heading right: up then left are both legal one after the other.
    expect(q.push(0, 1)).toBe(true);
    expect(q.push(3, 1)).toBe(true);
    expect(q.push(2, 1)).toBe(false); // queue full
    expect(q.take(1)).toBe(0);
    expect(q.take(0)).toBe(3);
    expect(q.take(3)).toBe(null);
  });

  it("ignores straight-on and U-turn presses", () => {
    const q = new TurnQueue();
    expect(q.push(1, 1)).toBe(false);
    expect(q.push(3, 1)).toBe(false);
    expect(q.size).toBe(0);
  });

  it("drops a queued turn that became illegal", () => {
    const q = new TurnQueue();
    q.push(0, 1);
    // By the time it's used the snake is already going up.
    expect(q.take(0)).toBe(null);
  });
});

describe("keys and swipes", () => {
  it("maps arrows / WASD and pause", () => {
    expect(dirForKey("ArrowUp", {})).toBe(0);
    expect(dirForKey("KeyD", {})).toBe(1);
    expect(dirForKey("KeyS", {})).toBe(2);
    expect(dirForKey("ArrowLeft", {})).toBe(3);
    expect(dirForKey("KeyQ", {})).toBe(null);
    expect(isPauseKey("KeyP", {})).toBe(true);
    expect(dirForKey("KeyI", { "snake-signal.up": ["KeyI"] })).toBe(0);
  });

  it("reads swipes", () => {
    expect(swipeToDir(5, 3)).toBe(null);
    expect(swipeToDir(40, 10)).toBe(1);
    expect(swipeToDir(-40, 10)).toBe(3);
    expect(swipeToDir(4, -30)).toBe(0);
    expect(swipeToDir(4, 30)).toBe(2);
  });

  it("has the shop catalog the server expects", () => {
    expect([SKINS.length, ARENAS.length, TRAILS.length]).toEqual([8, 8, 6]);
    expect(SKINS[0].id).toBe("neon");
    expect(itemName("trail:comet")).toBe("Comet Tail trail");
  });
});
