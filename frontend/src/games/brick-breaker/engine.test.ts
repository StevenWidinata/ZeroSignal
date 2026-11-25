import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/brick_vectors.json";
import { Rng } from "../../platform/seeded";
import { FIRE, Game, LAUNCH, replay, rules, waveLayout, type Input, type Level } from "./engine";

type Run = { seed: number; level: Level | null; stop_at: number | null; inputs: number[][]; summary: unknown };
const runs = (vectors as { runs: Run[] }).runs;

describe("brick breaker engine", () => {
  it("replays the shared vectors exactly like the server", () => {
    expect(runs.length).toBeGreaterThanOrEqual(6);
    for (const run of runs) {
      const inputs = run.inputs.map(([t, v]) => [t, v] as Input);
      expect(replay(run.seed, run.level, inputs, run.stop_at)).toEqual(run.summary);
    }
  });

  it("rejects bad input lists", () => {
    const lv = runs[0].level;
    expect(replay(1, lv, [[5, 100], [4, 200]])).toBe("unsorted");
    expect(replay(1, lv, [[5, 100], [5, 200]])).toBe("duplicate");
    expect(replay(1, lv, [[5, LAUNCH], [5, LAUNCH]])).toBe("duplicate");
    expect(replay(1, lv, [[5, -3]])).toBe("bad_input");
    expect(replay(1, lv, [[5, rules.width + 1]])).toBe("bad_input");
    expect(replay(1, lv, [[5, 10.5]])).toBe("bad_input");
    expect(replay(1, lv, [[999_999, 100]])).toBe("after_end");
    expect(typeof replay(1, lv, [[5, 100], [5, LAUNCH], [5, FIRE]])).toBe("object");
  });

  it("the paddle cannot teleport", () => {
    const g = new Game(1, runs[0].level);
    const x0 = g.paddle_x;
    g.step(0, false, false);
    expect(g.paddle_x).toBe(x0 - rules.paddle_speed);
  });

  it("makes the same wave walls as the server", () => {
    // The Endless vector runs only match if these do too; spot-check growth.
    const rng = new Rng(1);
    const w1 = waveLayout(rng, 1);
    const w9 = waveLayout(rng, 9);
    expect(w9.length).toBeGreaterThan(w1.length);
    expect(w1.every((b) => b.t !== "s" && !b.m)).toBe(true);
  });

  it("reports events for breaking bricks", () => {
    const run = runs[1];
    const g = new Game(run.seed, run.level);
    let i = 0;
    let breaks = 0;
    while (g.over === null) {
      let target: number | null = null;
      let launch = false;
      let fire = false;
      while (i < run.inputs.length && run.inputs[i][0] === g.tick) {
        const v = run.inputs[i++][1];
        if (v === LAUNCH) launch = true;
        else if (v === FIRE) fire = true;
        else target = v;
      }
      g.step(target, launch, fire);
      breaks += g.events.filter((e) => e.type === "break").length;
    }
    expect(breaks).toBe(g.s.bricks);
  });
});
