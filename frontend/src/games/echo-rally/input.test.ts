import { describe, expect, it } from "vitest";
import { Game, rules } from "./engine";
import { RallyControl, courtY } from "./input";
import { replay, startMatch } from "./replay";

describe("echo rally controls", () => {
  it("maps board spots to the 100-unit grid", () => {
    expect(courtY(0)).toBe(0);
    expect(courtY(1)).toBe(rules.height);
    expect(courtY(0.5)).toBe(rules.height / 2);
    expect(courtY(-1)).toBe(0);
    expect(courtY(0.12345) % 100).toBe(0);
  });

  it("slides with keys, stops on release, and logs only changes", () => {
    const g = new Game(1, 5, [[], []]);
    const c = new RallyControl();
    c.up = true;
    const a = c.next(g);
    expect(a.target).toBe(0);
    g.step([a, { target: null, fire: null }]);
    expect(c.next(g).target).toBeNull();
    c.up = false;
    g.step([{ target: null, fire: null }, { target: null, fire: null }]);
    const stop = c.next(g);
    expect(stop.target).toBe(courtY(g.pads[0].y / rules.height));
    c.point(12_300);
    expect(c.next(g).target).toBe(12_300);
    expect(c.log.map(([, v]) => v)).toEqual([0, stop.target, 12_300]);
  });

  it("fires each kit slot once, one per tick, and never logs a refused fire", () => {
    const g = new Game(1, 5, [["grow", "smash", "shield"], []]);
    const c = new RallyControl();
    c.fire(0);
    c.fire(0);
    c.fire(2);
    const a = c.next(g);
    expect(a.fire).toBe(0);
    g.step([a, { target: null, fire: null }]);
    expect(c.next(g).fire).toBe(2);
    c.fire(0);
    expect(c.next(g).fire).toBeNull();
    expect(c.log).toEqual([
      [0, -1],
      [1, -3],
    ]);
    const classic = new RallyControl();
    classic.fire(1);
    expect(classic.next(new Game(1, 5, [[], []])).fire).toBeNull();
  });

  it("records a match the server can replay", () => {
    const m = { seed: 77, target: 5, level: 0, chaos: true, kit: ["grow", "echo", "smash"] as const };
    const { game: g, bot } = startMatch({ ...m, kit: [...m.kit] });
    const c = new RallyControl();
    for (let t = 0; g.over === null && t < 3000; t++) {
      const ball = g.balls[0];
      if (ball) c.point(courtY(ball.y / rules.height));
      if (t === 100) c.fire(1);
      if (t === 400) c.fire(0);
      g.step([c.next(g), bot.control(g)]);
    }
    const stop = g.over === null ? g.tick : null;
    if (stop !== null) g.quit(0);
    expect(replay({ ...m, kit: [...m.kit] }, c.log, stop)).toEqual(g.s);
    expect(g.s.powers[0]).toBe(2);
  });
});
