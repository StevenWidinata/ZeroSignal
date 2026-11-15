import { describe, expect, it } from "vitest";
import { Bursts, MAX_PARTICLES } from "./burst";

describe("bursts", () => {
  it("spawns, moves and expires particles", () => {
    const b = new Bursts();
    b.spawn(10, 10, "#fff", { count: 8, life: 100 });
    expect(b.particles).toHaveLength(8);
    b.step(50);
    expect(b.particles.some((p) => p.x !== 10 || p.y !== 10)).toBe(true);
    b.step(60);
    expect(b.particles).toHaveLength(0);
  });

  it("never keeps more than the cap", () => {
    const b = new Bursts();
    for (let i = 0; i < 50; i++) b.spawn(0, 0, "#fff", { count: 20 });
    expect(b.particles.length).toBe(MAX_PARTICLES);
  });
});
