import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/checkers_vectors.json";
import { Game, decode, encode, notation, parsePath, perft, rc, sqAt } from "./rules";

describe("checkers rules", () => {
  it("maps squares both ways", () => {
    for (let sq = 0; sq < 32; sq++) {
      const [r, c] = rc(sq);
      expect(sqAt(r, c)).toBe(sq);
    }
    expect(sqAt(0, 0)).toBe(null);
  });

  it("matches the published perft numbers", () => {
    const g = new Game();
    vectors.perft.forEach((n, d) => expect(perft(g, d + 1), `depth ${d + 1}`).toBe(n));
  });

  it("finds exactly the server's legal moves in shared positions", () => {
    expect(vectors.positions.length).toBeGreaterThanOrEqual(50);
    for (const p of vectors.positions) {
      const pos = decode(p.pos);
      expect(pos).not.toBeNull();
      const g = new Game(pos!.cells, pos!.turn);
      expect(g.legalMoves().map(notation).sort(), p.pos).toEqual(p.moves);
    }
  });

  it("replays the shared game to the same end", () => {
    const g = Game.replay(vectors.game.moves);
    expect(g).not.toBeNull();
    expect(encode(g!.cells, g!.turn)).toBe(vectors.game.end);
    const o = g!.outcome();
    expect(o.kind === "win" ? o.side : o.kind).toBe(vectors.game.outcome);
  });

  it("parses notation and rejects bad moves", () => {
    expect(parsePath("9x18x27")).toEqual([8, 17, 26]);
    expect(parsePath("0-5")).toBe(null);
    expect(parsePath("12")).toBe(null);
    expect(Game.replay("11-20")).toBe(null);
    expect(Game.replay("11-15 23-19")).not.toBeNull();
  });

  it("draws on the third repetition", () => {
    const cells = Array(32).fill(0);
    cells[0] = 2;
    cells[31] = -2;
    const g = new Game(cells, "dark");
    for (const m of ["1-5", "32-28", "5-1", "28-32", "1-5", "32-28", "5-1", "28-32"]) g.playPath(parsePath(m)!);
    expect(g.outcome().kind).toBe("draw");
  });
});
