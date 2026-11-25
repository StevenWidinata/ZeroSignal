import { describe, expect, it } from "vitest";
import { FIRE, Game, LAUNCH, replay, rules } from "./engine";
import { PaddleControl, actionForKey, arenaX } from "./input";
import { levelById } from "./levels";

/** Plays `ticks` ticks with `drive` changing the controls before each one. */
function play(g: Game, c: PaddleControl, ticks: number, drive: (t: number) => void) {
  for (let t = 0; t < ticks && g.over === null; t++) {
    drive(g.tick);
    const { target, launch, fire } = c.next(g);
    g.step(target, launch, fire);
  }
}

describe("brick breaker paddle controls", () => {
  it("maps a spot on the board to the 100-unit grid", () => {
    expect(arenaX(0)).toBe(0);
    expect(arenaX(1)).toBe(rules.width);
    expect(arenaX(0.5)).toBe(24_000);
    expect(arenaX(0.12345)).toBe(5_900);
    expect(arenaX(-3)).toBe(0);
    expect(arenaX(7)).toBe(rules.width);
  });

  it("logs a held key once and stops the paddle on release", () => {
    const g = new Game(1, levelById(1));
    const c = new PaddleControl();
    play(g, c, 20, (t) => {
      c.left = t < 10;
    });
    const targets = c.log.filter(([, v]) => v >= 0);
    expect(targets[0]).toEqual([0, 0]);
    // One target for the slide, one to stop where the paddle got to.
    expect(targets).toHaveLength(2);
    expect(targets[1][0]).toBe(10);
    expect(targets[1][1]).toBe(arenaX(g.paddle_x / rules.width));
  });

  it("launches only a held ball and fires only with a laser", () => {
    const g = new Game(2, levelById(1));
    const c = new PaddleControl();
    c.press();
    c.release();
    play(g, c, 1, () => undefined);
    expect(c.log).toEqual([[0, LAUNCH]]);
    // The ball is in play now: pressing again does nothing.
    c.press();
    play(g, c, 1, () => undefined);
    expect(c.log).toHaveLength(1);
    // With a laser, holding fires whenever it is ready.
    g.laser = 100;
    c.press();
    play(g, c, 45, () => undefined);
    c.release();
    const shots = c.log.filter(([, v]) => v === FIRE);
    expect(shots.length).toBe(3);
  });

  it("only logs pointer moves that change the target", () => {
    const g = new Game(3, null);
    const c = new PaddleControl();
    play(g, c, 6, (t) => c.point(t < 3 ? 10_000 : 30_000));
    expect(c.log).toEqual([
      [0, 10_000],
      [3, 30_000],
    ]);
  });

  it("the log replays to the same run", () => {
    const g = new Game(77, levelById(3));
    const c = new PaddleControl();
    play(g, c, 4000, (t) => {
      const ball = g.balls[0];
      if (ball) c.point(arenaX(ball.x / rules.width));
      if (t % 90 === 0) c.press();
      else c.release();
      c.right = t % 500 < 20;
    });
    g.quit();
    expect(replay(77, levelById(3), c.log, g.tick)).toEqual(g.s);
  });

  it("reads the default keys", () => {
    expect(actionForKey("ArrowLeft", {})).toBe("left");
    expect(actionForKey("KeyD", {})).toBe("right");
    expect(actionForKey("Space", {})).toBe("launch");
    expect(actionForKey("KeyP", {})).toBe("pause");
    expect(actionForKey("KeyQ", {})).toBeNull();
  });
});
