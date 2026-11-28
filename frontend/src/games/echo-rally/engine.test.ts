import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/rally_vectors.json";
import { Bot, botKit } from "./bot";
import { Game, kitOk, NO_INPUT, padH, rules, type Input, type Power } from "./engine";
import { replay, startMatch, type BotMatch } from "./replay";

type Vector = {
  seed: number;
  target: number;
  level: number;
  chaos: boolean;
  kit: Power[];
  stop_at: number | null;
  inputs: Input[];
  summary: unknown;
};
const matches = (vectors as { matches: Vector[] }).matches;
const m = (over: Partial<BotMatch> = {}): BotMatch => ({ seed: 1, target: 5, level: 0, chaos: false, kit: [], ...over });

describe("echo rally engine", () => {
  it("replays the shared vectors exactly like the server", () => {
    expect(matches.length).toBeGreaterThanOrEqual(7);
    for (const v of matches) {
      const got = replay({ seed: v.seed, target: v.target, level: v.level, chaos: v.chaos, kit: v.kit }, v.inputs, v.stop_at);
      expect(got).toEqual(v.summary);
    }
  });

  it("rejects bad matches and inputs", () => {
    expect(replay(m({ target: 6 }), [])).toBe("bad_match");
    expect(replay(m({ level: 4 }), [])).toBe("bad_match");
    expect(replay(m({ kit: ["grow"] }), [])).toBe("bad_kit");
    expect(replay(m({ chaos: true }), [])).toBe("bad_kit");
    expect(replay(m({ chaos: true, kit: ["grow", "grow", "fog"] }), [])).toBe("bad_kit");
    expect(replay(m(), [[5, 10], [4, 10]])).toBe("unsorted");
    expect(replay(m(), [[5, rules.height + 1]])).toBe("bad_input");
    expect(replay(m(), [[5, -4]])).toBe("bad_input");
    expect(replay(m(), [[5, 1.5]])).toBe("bad_input");
    expect(replay(m(), [[-1, 10]])).toBe("bad_input");
    expect(replay(m(), [[5, -1]])).toBe("bad_fire");
    expect(replay(m(), [[5, 10], [5, 20]])).toBe("duplicate");
    expect(replay(m(), [[5, 10], [9_999_999, 20]])).toBe("after_end");
    expect(replay(m(), new Array(rules.max_inputs + 1).fill([0, 0]))).toBe("too_many_inputs");
    const chaos = m({ chaos: true, kit: ["grow", "fog", "echo"] });
    expect(replay(chaos, [[5, -1], [9, -1]])).toBe("bad_fire");
    expect(replay(chaos, [[5, -1], [5, -2]])).toBe("duplicate");
    expect(replay(m(), [], 300)).toMatchObject({ ended_by: "quit", ticks: 300, winner: 1 });
  });

  it("matches a live game recorded the way the browser records it", () => {
    const match = m({ seed: 42, level: 1, chaos: true, kit: ["smash", "shield", "fog"] });
    const { game: g, bot } = startMatch(match);
    const me = new Bot(7, 0, 2, g);
    const inputs: Input[] = [];
    let last = g.pads[0].target;
    while (g.over === null) {
      const c = me.control(g);
      if (c.target === last) c.target = null;
      else if (c.target !== null) {
        last = c.target;
        inputs.push([g.tick, c.target]);
      }
      if (c.fire !== null) inputs.push([g.tick, -1 - c.fire]);
      g.step([c, bot.control(g)]);
    }
    expect(replay(match, inputs)).toEqual(g.s);
    expect(g.s.ended_by).toBe("win");
  });

  it("reports serves, hits and points as events", () => {
    const g = new Game(3, 5, [[], []]);
    const park = { target: 0, fire: null };
    let serves = 0;
    let points = 0;
    while (g.over === null) {
      g.step([park, park]);
      serves += g.events.filter((e) => e.type === "serve").length;
      points += g.events.filter((e) => e.type === "point").length;
    }
    expect(points).toBe(g.points());
    expect(serves).toBe(points);
    expect(g.events).toContainEqual({ type: "over", winner: g.s.winner });
  });

  it("fires each power once", () => {
    const g = new Game(4, 5, [["grow", "shrink", "shield"], ["freeze", "fog", "multi-ball"]]);
    while (g.balls.length === 0) g.step([NO_INPUT, NO_INPUT]);
    g.step([{ target: null, fire: 0 }, { target: null, fire: 0 }]);
    expect(padH(g.pads[0])).toBe((rules.pad_h * rules.powers.grow_pct) / 100);
    expect(g.pads[0].freeze).toBeGreaterThan(0);
    g.step([{ target: null, fire: 0 }, { target: null, fire: 2 }]);
    expect(g.s.powers).toEqual([1, 2]);
    expect(g.balls.length).toBe(2);
    expect(g.canFire(0, 0)).toBe(false);
  });

  it("checks kits and gives Zero-Bot its own", () => {
    expect(kitOk(["grow", "fog", "echo"])).toBe(true);
    expect(kitOk(["grow", "fog"])).toBe(false);
    expect(kitOk(["grow", "fog", "nope" as Power])).toBe(false);
    for (let level = 0; level < 4; level++) {
      const k = botKit(9, level);
      expect(k.length).toBe(rules.bot[level].powers);
      expect(k).not.toContain("echo");
      expect(new Set(k).size).toBe(k.length);
    }
  });
});
