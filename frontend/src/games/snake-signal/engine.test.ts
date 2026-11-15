import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/snake_vectors.json";
import { Game, replay, type Dir, type Mode, type Size, type Turn } from "./engine";

describe("snake signal engine", () => {
  it("replays the shared vectors exactly like the server", () => {
    expect(vectors.runs.length).toBeGreaterThanOrEqual(6);
    for (const run of vectors.runs) {
      const turns = run.turns.map(([t, d]) => [t, d as Dir] as Turn);
      expect(replay(run.seed, run.mode as Mode, run.size as Size, turns)).toEqual(run.summary);
    }
  });

  it("going straight hits the wall", () => {
    const s = replay(1, "classic", "medium", []);
    expect(typeof s === "object" && s.ended_by).toBe("wall");
    expect(typeof s === "object" && s.ticks).toBe(10);
  });

  it("rejects bad turn lists", () => {
    expect(replay(1, "classic", "medium", [[0, 3]])).toBe("bad_turn");
    expect(replay(1, "classic", "medium", [[0, 1]])).toBe("bad_turn");
    expect(
      replay(1, "classic", "medium", [
        [2, 0],
        [1, 1],
      ]),
    ).toBe("unsorted");
    expect(replay(1, "classic", "medium", [[500, 0]])).toBe("after_end");
  });

  it("chasing your own tail is legal but the signal fades", () => {
    const cycle: Dir[] = [0, 3, 2, 1];
    const turns: Turn[] = Array.from({ length: 250 }, (_, t) => [t, cycle[t % 4]]);
    const s = replay(9, "classic", "medium", turns);
    expect(typeof s === "object" && s.ended_by).toBe("signal");
  });

  it("quitting banks the points so far", () => {
    const run = vectors.runs[0];
    const early = run.turns.filter(([t]) => t < 200).map(([t, d]) => [t, d as Dir] as Turn);
    const s = replay(run.seed, run.mode as Mode, run.size as Size, early, 200);
    expect(typeof s === "object" && s.ended_by).toBe("quit");
    expect(typeof s === "object" && s.ticks).toBe(200);
    expect(replay(1, "classic", "medium", [[5, 0]], 5)).toBe("after_end");
  });

  it("reports events for eating", () => {
    const g = new Game(11, "classic", "medium");
    // Walk the vector run and check that every eaten packet produced an event.
    const run = vectors.runs[0];
    let i = 0;
    let foods = 0;
    while (g.over === null) {
      let turn: Dir | null = null;
      if (i < run.turns.length && run.turns[i][0] === g.tick) turn = run.turns[i++][1] as Dir;
      g.step(turn);
      foods += g.events.filter((e) => e.type === "food").length;
    }
    expect(foods).toBe(run.summary.eaten);
  });
});
