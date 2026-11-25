import { describe, expect, it } from "vitest";
import { DROPS } from "./engine";
import { LEVELS, LEVEL_COUNT, levelById } from "./levels";

describe("brick breaker levels", () => {
  it("has 24 levels in two worlds of 12", () => {
    expect(LEVEL_COUNT).toBe(24);
    LEVELS.forEach((l, i) => {
      expect(l.level.id).toBe(i + 1);
      expect(l.world).toBe(i < 12 ? 1 : 2);
      expect(l.level.name.length).toBeGreaterThan(0);
    });
    expect(levelById(24)?.name).toBe("Final Signal");
    expect(levelById(99)).toBeNull();
  });

  it("places every drop on a breakable brick and every drop kind in each world", () => {
    for (const { level } of LEVELS) {
      for (const b of level.bricks) if (b.d) expect(b.t).not.toBe("s");
    }
    for (const world of [1, 2]) {
      for (const d of DROPS) {
        expect(LEVELS.some((l) => l.world === world && l.level.bricks.some((b) => b.d === d))).toBe(true);
      }
    }
  });
});
