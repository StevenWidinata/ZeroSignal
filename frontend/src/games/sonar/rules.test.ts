import { describe, expect, it } from "vitest";
import vectors from "../../../../shared/sonar_vectors.json";
import { cellName, fleetCode, isError, parseCell, parseFleet, parseMove, pingArea, randomFleet, Sea, shortResult, validateFleet } from "./rules";

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
