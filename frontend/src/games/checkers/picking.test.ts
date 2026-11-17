import { describe, expect, it } from "vitest";
import { click, movable, nextSteps, toPaths } from "./picking";

describe("picking checkers moves", () => {
  it("picks a simple move in two clicks", () => {
    const legal = toPaths(["11-15", "11-16", "12-16"]);
    expect([...movable(legal)].sort()).toEqual([10, 11]);
    const a = click(legal, [], 10);
    expect(a).toEqual({ kind: "picking", picked: [10] });
    expect([...nextSteps(legal, [10])].sort()).toEqual([14, 15]);
    expect(click(legal, [10], 14)).toEqual({ kind: "done", notation: "11-15" });
  });

  it("walks a capture chain one landing square at a time", () => {
    const legal = toPaths(["10x17x26", "10x17x24"]);
    const a = click(legal, [], 9);
    expect(a.kind).toBe("picking");
    const b = click(legal, [9], 16);
    expect(b).toEqual({ kind: "picking", picked: [9, 16] });
    expect(click(legal, [9, 16], 25)).toEqual({ kind: "done", notation: "10x17x26" });
  });

  it("switches piece or clears on other squares", () => {
    const legal = toPaths(["11-15", "12-16"]);
    expect(click(legal, [10], 11)).toEqual({ kind: "picking", picked: [11] });
    expect(click(legal, [10], 30)).toEqual({ kind: "none" });
  });
});
