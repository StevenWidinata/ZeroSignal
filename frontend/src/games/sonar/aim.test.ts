import { describe, expect, it } from "vitest";
import { aimCode, aimPreview, startAim, strikeBow, tapAim, turnAim } from "./aim";
import { parseMove } from "./rules";
import { AIR_STRIKE, FLARE, RADAR, SALVO, TORPEDO } from "./tactics";

const blank = ".".repeat(100);

describe("aiming Sonar powers", () => {
  it("centres air strikes on the tapped square and keeps them on the grid", () => {
    expect(strikeBow(44, true, 3)).toBe(43);
    expect(strikeBow(40, true, 3)).toBe(40);
    expect(strikeBow(49, true, 3)).toBe(47);
    expect(strikeBow(94, false, 4)).toBe(64);
    let a = tapAim(startAim(AIR_STRIKE), 44, 3, blank).aim;
    expect(aimPreview(a, 3, blank)).toEqual({ cells: [43, 44, 45], ok: true });
    a = turnAim(a, 3);
    expect(aimCode(a, 3, blank)).toBe("a34v");
  });

  it("fires on a second tap of the same square", () => {
    const first = tapAim(startAim(FLARE), 55, 5, blank);
    expect(first.fire).toBe(false);
    expect(tapAim(first.aim, 55, 5, blank).fire).toBe(true);
    expect(tapAim(first.aim, 56, 5, blank)).toEqual({ aim: { ...first.aim, cell: 56 }, fire: false });
  });

  it("won't light a flare where everything is known", () => {
    const known = blank.split("");
    for (const c of [0, 1, 10]) known[c] = "o";
    const a = tapAim(startAim(FLARE), 0, 5, known.join("")).aim;
    expect(aimPreview(a, 5, known.join(""))?.ok).toBe(false);
    expect(aimCode(a, 5, known.join(""))).toBeNull();
  });

  it("collects salvo squares and only fires when it has them all", () => {
    let a = startAim(SALVO);
    a = tapAim(a, 3, 2, blank).aim;
    expect(aimCode(a, 2, blank)).toBeNull();
    a = tapAim(a, 70, 2, blank).aim;
    a = tapAim(a, 71, 2, blank).aim; // full: ignored
    expect(aimCode(a, 2, blank)).toBe("b3.70");
    a = tapAim(a, 3, 2, blank).aim; // tap again: removed
    expect(a.picks).toEqual([70]);
  });

  it("sweeps rows and columns and turns torpedoes through the edges it may use", () => {
    let r = tapAim(startAim(RADAR), 37, 1, blank).aim;
    expect(aimCode(r, 1, blank)).toBe("r3");
    r = turnAim(r, 1);
    expect(aimCode(r, 1, blank)).toBe("k7");
    let t = tapAim(startAim(TORPEDO), 37, 2, blank).aim;
    expect(aimCode(t, 2, blank)).toBe("t3l");
    t = turnAim(t, 2);
    expect(aimCode(t, 2, blank)).toBe("t7u");
    expect(turnAim(t, 2).edge).toBe("l"); // Mk I: left and top only
    expect(turnAim(t, 4).edge).toBe("r");
    expect(aimPreview({ ...t, edge: "d" }, 4, blank)?.cells[0]).toBe(97);
  });

  it("only makes codes the rules can read", () => {
    for (const code of ["a43h", "b3.70", "r3", "k7", "t3l", "l55"]) expect(parseMove(code), code).not.toBeNull();
  });
});

describe("Workshop upgrade texts", () => {
  it("says what each next Mk improves", async () => {
    const { upgradeText, POWERS } = await import("./tactics");
    const texts = POWERS.map((_, p) => [upgradeText(p, 1), upgradeText(p, 2)]);
    expect(texts[AIR_STRIKE]).toEqual(["recharges in 5 turns instead of 6", "hits 4 squares instead of 3"]);
    expect(texts[SALVO]).toEqual(["3 shots instead of 2", "recharges in 4 turns instead of 5"]);
    expect(texts[TORPEDO][1]).toBe("can start from any edge");
    expect(texts[FLARE]).toEqual(["recharges in 3 turns instead of 4", "lights the whole 3×3 area"]);
    expect(upgradeText(RADAR, 3)).toBe("Fully upgraded");
    // Every upgrade improves something.
    for (const t of texts.flat()) expect(t).not.toBe("");
  });
});
