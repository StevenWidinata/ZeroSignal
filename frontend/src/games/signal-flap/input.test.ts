import { describe, expect, it } from "vitest";
import { Game, replay } from "./engine";
import { FlapControl, actionForKey } from "./input";

describe("signal flap controls", () => {
  it("turns presses into one flap per tick and logs them for the server", () => {
    const g = new Game(5);
    const c = new FlapControl();
    for (let i = 0; i < 40; i++) {
      if (i === 3) {
        c.press();
        c.press();
      }
      if (i === 20) c.press();
      g.step(c.next(g));
    }
    expect(c.log).toEqual([3, 20]);
    expect(g.s.flaps).toBe(2);
    g.quit();
    expect(replay(5, c.log, 40)).toEqual(g.s);
  });

  it("forgets a press on reset", () => {
    const g = new Game(5);
    const c = new FlapControl();
    c.press();
    c.reset();
    expect(c.next(g)).toBe(false);
    expect(c.log).toEqual([]);
  });

  it("maps keys, including rebinding", () => {
    expect(actionForKey("Space", {})).toBe("flap");
    expect(actionForKey("ArrowUp", {})).toBe("flap");
    expect(actionForKey("KeyW", {})).toBe("flap");
    expect(actionForKey("KeyP", {})).toBe("pause");
    expect(actionForKey("Escape", {})).toBe("pause");
    expect(actionForKey("KeyQ", {})).toBe(null);
    expect(actionForKey("KeyQ", { "signal-flap.flap": ["KeyQ"] })).toBe("flap");
  });
});
