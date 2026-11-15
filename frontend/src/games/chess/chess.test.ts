import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { isLight, kingIndex, lastOf, movesBetween, movesFrom, parseFen, sideToMove, squareIndex, squareName } from "./fen";
import { BOARDS, PIECE_SETS, itemName } from "./items";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("fen helpers", () => {
  it("reads the start position", () => {
    const b = parseFen(START);
    expect(b).toHaveLength(64);
    expect(b[0]).toEqual({ type: "r", color: "b" }); // a8
    expect(b[60]).toEqual({ type: "k", color: "w" }); // e1
    expect(b.filter(Boolean)).toHaveLength(32);
    expect(kingIndex(b, "b")).toBe(squareIndex("e8"));
    expect(sideToMove(START)).toBe("w");
  });

  it("names squares both ways and colours them like a real board", () => {
    for (let i = 0; i < 64; i++) expect(squareIndex(squareName(i))).toBe(i);
    expect(squareName(0)).toBe("a8");
    expect(squareName(63)).toBe("h1");
    expect(isLight(squareIndex("h1"))).toBe(true);
    expect(isLight(squareIndex("a1"))).toBe(false);
  });

  it("groups legal moves and finds promotions", () => {
    const c = new Chess("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    const legal = c.moves({ verbose: true }).map((m) => m.lan);
    expect(movesBetween(legal, "e7", "e8").sort()).toEqual(["e7e8b", "e7e8n", "e7e8q", "e7e8r"]);
    expect(movesFrom(legal).get("e1")?.length).toBe(5);
    expect(lastOf(legal)).toBe(legal[legal.length - 1]);
    expect(lastOf([])).toBeNull();
  });

  it("chess.js and the server agree on UCI castling", () => {
    const c = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const lan = c.moves({ verbose: true }).map((m) => m.lan);
    expect(lan).toContain("e1g1");
    expect(lan).toContain("e1c1");
  });
});

describe("chess items", () => {
  it("has 12 boards (6 free) and 8 piece sets (4 free)", () => {
    expect(BOARDS).toHaveLength(12);
    expect(BOARDS.filter((b) => b.price === null)).toHaveLength(6);
    expect(PIECE_SETS).toHaveLength(8);
    expect(PIECE_SETS.filter((p) => p.price === null)).toHaveLength(4);
    expect(itemName("board:neon")).toBe("Neon");
    expect(itemName("pieces:space")).toBe("Space");
  });
});
