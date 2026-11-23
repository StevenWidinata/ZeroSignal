import { describe, expect, it } from "vitest";
import {
  DECK,
  POWERS,
  blockAt,
  describeLast,
  faceDown,
  findPower,
  playerOf,
  positionAt,
  powerCode,
  toggleKit,
  usableKit,
} from "./logic";

const p = (id: string) => findPower(id)!;

describe("memory match logic", () => {
  it("has 10 powers (5 free) and 18 different symbols", () => {
    expect(POWERS).toHaveLength(10);
    expect(POWERS.filter((x) => x.price === null).map((x) => x.id)).toEqual(["shuffle", "swap", "peek", "fog", "second-chance"]);
    expect(new Set(DECK).size).toBe(18);
    // No card symbol looks like a power icon.
    expect(DECK.some((s) => POWERS.some((x) => x.icon === s))).toBe(false);
  });

  it("maps seats to players and mirrors rows", () => {
    expect(playerOf(1, 1)).toBe(0);
    expect(playerOf(1, 2)).toBe(1);
    expect(positionAt(5, 4, false)).toBe(5);
    expect(positionAt(4, 4, true)).toBe(7);
    expect(positionAt(7, 4, true)).toBe(4);
    expect(positionAt(6, 6, true)).toBe(11);
  });

  it("clamps a tapped block so it fits", () => {
    expect(blockAt(0, 4, 4)).toEqual([0, 1, 5, 4]);
    expect(blockAt(15, 4, 4)).toEqual([10, 11, 15, 14]);
    expect(blockAt(3, 4, 6)).toEqual([2, 3, 7, 6]);
  });

  it("builds power codes only for good targets", () => {
    const cells = [0, 0, -1, 3, 0, 0, 0, 0, 0, 0, -1, -1, 0, 0, -1, -1];
    const info = { cells, cols: 4, rows: 4 };
    expect(faceDown(cells)).not.toContain(3);
    expect(powerCode(p("fog"), [], info)).toBe("fog");
    expect(powerCode(p("swap"), [0], info)).toBeNull();
    expect(powerCode(p("swap"), [0, 4], info)).toBe("swap:0,4");
    expect(powerCode(p("swap"), [0, 2], info)).toBeNull(); // taken
    expect(powerCode(p("peek"), [0, 3], info)).toBeNull(); // face up
    expect(powerCode(p("rotate"), [15], info)).toBeNull(); // block 10 11 15 14 is empty
    expect(powerCode(p("rotate"), [5], info)).toBe("rotate:5");
    expect(powerCode(p("x-ray"), [13], info)).toBe("x-ray:3");
  });

  it("describes the last move from your side", () => {
    expect(describeLast({ player: 0, kind: "match", cards: [[1, 0], [5, 0]], power: null, spots: [], kept_turn: true }, 0, "Ana")).toBe(
      "You found a pair: 🍎 🍎",
    );
    expect(describeLast({ player: 1, kind: "power", cards: [], power: "shuffle", spots: [1, 2, 3, 4, 5, 6], kept_turn: true }, 0, "Ana")).toBe(
      "Ana used 🌀 Shuffle on 6 cards",
    );
    expect(describeLast({ player: 1, kind: "miss", cards: [[1, 0], [2, 1]], power: null, spots: [], kept_turn: true }, 0, "Ana")).toMatch(
      /Second Chance/,
    );
    expect(describeLast({ player: 0, kind: "flip", cards: [[1, 0]], power: null, spots: [], kept_turn: false }, 0, "Ana")).toBeNull();
  });

  it("keeps a remembered kit to owned, real, different powers", () => {
    expect(usableKit(["mirror", "swap", "swap", "nope", "fog", "peek"], (id) => id !== "mirror")).toEqual(["swap", "fog", "peek"]);
    expect(toggleKit(["swap"], "fog")).toEqual(["swap", "fog"]);
    expect(toggleKit(["swap", "fog"], "swap")).toEqual(["fog"]);
    expect(toggleKit(["swap", "fog", "peek"], "lock")).toEqual(["swap", "fog", "peek"]);
  });
});
