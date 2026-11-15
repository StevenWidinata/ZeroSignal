import type { SonarSea } from "../../api/types";
import { FLEET, parseFleet, shipCells, type Placement, type Sea } from "./rules";

export interface DrawnShip {
  ship: number;
  cells: number[];
}

/** The ships of a fleet code (or placements) as cell lists, for drawing. */
export function shipsOf(fleet: string | (Placement | null)[] | null | undefined): DrawnShip[] {
  if (!fleet) return [];
  let ships: (Placement | null)[];
  if (typeof fleet === "string") {
    const f = parseFleet(fleet);
    if ("error" in f) return [];
    ships = f.ships;
  } else ships = fleet;
  const out: DrawnShip[] = [];
  ships.forEach((p, i) => {
    const cells = p && shipCells(p, FLEET[i].len);
    if (cells) out.push({ ship: i, cells });
  });
  return out;
}

/** "Hit!", "Miss", "Sunk their Cruiser!", "Ping: 3 ship squares". */
export function resultText(r: { kind: string; ship?: number; count?: number }, whose: "their" | "your" = "their"): string {
  if (r.kind === "miss") return "Miss";
  if (r.kind === "hit") return "Hit!";
  if (r.kind === "sunk") return `Sunk ${whose} ${FLEET[r.ship ?? 0].name}!`;
  return `Ping: ${r.count} ship square${r.count === 1 ? "" : "s"} nearby`;
}

/** "C7" for cell 62 (upper case for display). */
export const label = (cell: number) => `${String.fromCharCode(65 + (cell % 10))}${Math.floor(cell / 10) + 1}`;

/** A browser-side Sea (same-device games) in the server's view shape. */
export function viewOf(sea: Sea): SonarSea {
  const sunk: { ship: number; cells: number[] }[] = [];
  const marks = sea.marks
    .map((m, cell) => {
      if (typeof m === "object") {
        const s = sunk.find((x) => x.ship === m.sunk);
        if (s) s.cells.push(cell);
        else sunk.push({ ship: m.sunk, cells: [cell] });
        return "s";
      }
      return m === "miss" ? "o" : m === "hit" ? "x" : m === "empty" ? "-" : ".";
    })
    .join("");
  return { marks, sunk, pings: [...sea.pings], pings_left: sea.pingsLeft(), shots: sea.moves.length, all_sunk: sea.allSunk() };
}
