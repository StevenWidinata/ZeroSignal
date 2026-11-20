import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/sonar_vectors.json";
import { cellName, Duel, FLEET, fleetCode, isError, markChar, moveCode, parseCell, parseFleet, parseMove, pingArea, randomFleet, Sea, shortResult, validateFleet, type Fleet } from "./rules";

interface TacticsCase {
  about: string;
  fleets: string[];
  first: number;
  levels: number[][] | null;
  seed?: number;
  crates?: number;
  moves: string;
  results: string[];
  own?: string[];
  error: string | null;
  next: number;
  winner: number | null;
  charge: number[][] | null;
  combo?: number[];
  overdrive?: boolean[];
  marks: Record<string, number[]>[];
}
import { POWERS } from "./tactics";

describe("sonar rules (same vectors as the server)", () => {
  it("checks fleets like the server", () => {
    for (const f of vectors.fleets) {
      const r = parseFleet(f.code);
      expect("error" in r ? r.error : null, f.code).toBe(f.error);
    }
  });

  it("plays shots and pings like the server", () => {
    for (const g of vectors.games) {
      const fleet = parseFleet(g.fleet);
      if ("error" in fleet) throw new Error(fleet.error);
      const sea = new Sea(fleet.ships);
      const got = g.moves.split(" ").map((t) => {
        const r = sea.play(parseMove(t)!);
        return isError(r) ? r : shortResult(r);
      });
      expect(got, g.moves).toEqual(g.results);
      expect(sea.allSunk()).toBe(g.all_sunk);
    }
  });

  it("takes turns and finds the winner like the server", () => {
    for (const c of vectors.duels) {
      const [a, b] = c.fleets.map((f) => {
        const r = parseFleet(f);
        if ("error" in r) throw new Error(r.error);
        return r;
      });
      const d = Duel.replay([a, b], c.first as 0 | 1, c.moves);
      if (isError(d)) throw new Error(d);
      expect(d.log.map((l) => shortResult(l.result)), c.moves).toEqual(c.results);
      expect(d.toMove()).toBe(c.next);
      expect(d.winner()).toBe(c.winner);
      expect(d.moveString()).toBe(c.moves);
      if (c.winner !== null) expect(d.play({ kind: "fire", cell: 99 })).toBe("over");
    }
  });

  it("plays Tactics powers like the server", () => {
    const fleetOf = (f: string): Fleet => {
      const r = parseFleet(f);
      if ("error" in r) throw new Error(r.error);
      return r;
    };
    for (const c of vectors.tactics as TacticsCase[]) {
      const setup = c.levels ? { levels: c.levels as [number[], number[]], seed: c.seed ?? 0, crates: c.crates ?? 0 } : null;
      const d = new Duel([fleetOf(c.fleets[0]), fleetOf(c.fleets[1])], c.first as 0 | 1, setup);
      const tokens = c.moves.split(" ");
      let error: string | null = null;
      tokens.forEach((t, i) => {
        const m = parseMove(t);
        if (!m) throw new Error(`${c.about}: can't parse ${t}`);
        const r = d.play(m);
        if (isError(r)) {
          expect(i, `${c.about}: only the last move may fail`).toBe(tokens.length - 1);
          error = r;
        }
      });
      expect(d.log.map((l) => l.results.map(([cell, r]) => `${cell}:${shortResult(r)}`).join(",")), c.about).toEqual(c.results);
      const own = d.log.map((l) => l.own.map(([cell, r]) => `${cell}:${shortResult(r)}`).join(","));
      expect(own, `${c.about}: own seas`).toEqual(c.own ?? own.map(() => ""));
      if (c.combo) expect(d.tactics?.combo, c.about).toEqual(c.combo);
      if (c.overdrive) expect(d.tactics?.overdrive, c.about).toEqual(c.overdrive);
      expect(error, c.about).toBe(c.error);
      expect(d.toMove(), c.about).toBe(c.next);
      expect(d.winner(), c.about).toBe(c.winner);
      expect(d.tactics?.charge ?? null, c.about).toEqual(c.charge);
      for (const s of [0, 1]) {
        const want = new Array<string>(100).fill(".");
        for (const [ch, cells] of Object.entries(c.marks[s] as Record<string, number[]>)) for (const cell of cells) want[cell] = ch;
        expect(d.seas[s].marks.map(markChar).join(""), `${c.about}: sea ${s}`).toBe(want.join(""));
      }
    }
  });

  it("writes and reads every move code", () => {
    for (const code of ["f0", "p99", "a12h", "a90v", "b1.2", "b1.2.3", "r0", "k9", "t3l", "t3r", "t0u", "t9d", "l45", "o0", "o4"]) {
      const m = parseMove(code);
      expect(m && moveCode(m)).toBe(code);
    }
    for (const bad of ["", "f", "f100", "f+3", "a12", "a12x", "b1", "b1.2.3.4", "r10", "t3", "t3x", "l100", "z1", "o5", "o"]) expect(parseMove(bad), bad).toBeNull();
  });

  it("gives every ship one power, in fleet order", () => {
    expect(POWERS.map((p) => p.ship)).toEqual(FLEET.map((s) => s.id));
  });

  it("names cells and pings 3×3 areas", () => {
    expect(parseCell("a1")).toBe(0);
    expect(parseCell("j10")).toBe(99);
    expect(parseCell("a01")).toBeNull();
    for (let c = 0; c < 100; c++) expect(parseCell(cellName(c))).toBe(c);
    expect(pingArea(0)).toEqual([0, 1, 10, 11]);
    expect(pingArea(55)).toHaveLength(9);
  });

  it("shuffles only legal fleets", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const ships = randomFleet(rand);
      expect(validateFleet(ships)).toBeNull();
      const again = parseFleet(fleetCode(ships));
      expect("ships" in again && again.ships).toEqual(ships);
    }
  });
});
