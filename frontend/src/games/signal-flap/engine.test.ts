import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/flap_vectors.json";
import { Game, gapBot, gapTop, groundY, replay, rules } from "./engine";

type Run = { seed: number; stop_at: number | null; flaps: number[]; summary: unknown };
const runs = (vectors as { runs: Run[] }).runs;

describe("signal flap engine", () => {
  it("replays the shared vectors exactly like the server", () => {
    expect(runs.length).toBeGreaterThanOrEqual(7);
    for (const run of runs) {
      expect(replay(run.seed, run.flaps, run.stop_at)).toEqual(run.summary);
    }
  });

  it("rejects bad flap lists", () => {
    expect(replay(1, [5, 4])).toBe("unsorted");
    expect(replay(1, [5, 5])).toBe("duplicate");
    expect(replay(1, [5, 9_999_999])).toBe("after_end");
    expect(replay(1, [-1])).toBe("bad_input");
    expect(replay(1, [5.5])).toBe("bad_input");
    expect(replay(1, new Array(rules.max_inputs + 1).fill(0))).toBe("too_many_inputs");
    expect(replay(1, [], 300)).toMatchObject({ ended_by: "quit", ticks: 300, score: 0 });
  });

  it("nothing moves before the first flap", () => {
    const g = new Game(7);
    const x0 = g.towers[0].x;
    for (let i = 0; i < 120; i++) g.step(false);
    expect(g.towers[0].x).toBe(x0);
    expect(g.y).toBe(rules.start_y);
    g.step(true);
    expect(g.started).toBe(true);
    expect(g.towers[0].x).toBeLessThan(x0);
    expect(g.events).toContainEqual({ type: "flap" });
  });

  it("keeps every gap inside the arena", () => {
    const g = new Game(99);
    g.started = true;
    while (g.next_idx < 200) {
      g.y = -100_000;
      g.step(false);
      g.over = null;
      for (const t of g.towers) {
        expect(gapTop(t)).toBeGreaterThanOrEqual(rules.margin);
        expect(gapBot(t)).toBeLessThanOrEqual(groundY() - rules.margin);
      }
    }
  });

  it("reports passes and bars as events", () => {
    const run = runs[0];
    const g = new Game(run.seed);
    let i = 0;
    let passes = 0;
    let bars = 0;
    while (g.over === null && g.tick < (run.stop_at ?? Infinity)) {
      const flap = i < run.flaps.length && run.flaps[i] === g.tick;
      if (flap) i++;
      g.step(flap);
      passes += g.events.filter((e) => e.type === "pass").length;
      bars += g.events.filter((e) => e.type === "bar").length;
    }
    expect(passes).toBe(g.s.gaps);
    expect(bars).toBe(g.s.bars);
    expect(passes).toBeGreaterThan(10);
  });
});
