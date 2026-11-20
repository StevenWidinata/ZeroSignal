import type { SonarSea } from "../../api/types";
import { FLEET, markChar, parseFleet, shipCells, type Placement, type Sea } from "./rules";
import { ITEMS, POWERS } from "./tactics";

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

/** "Hit!", "Miss", "Sunk their Cruiser!", "Ping: 3 ship squares nearby", "Radar: 2 ship squares in that line". */
export function resultText(r: { kind: string; ship?: number; count?: number; item?: string; power?: number }, whose: "their" | "your" = "their"): string {
  const squares = `${r.count} ship square${r.count === 1 ? "" : "s"}`;
  if (r.kind === "miss") return "Miss";
  if (r.kind === "hit") return "Hit!";
  if (r.kind === "sunk") return `Sunk ${whose} ${FLEET[r.ship ?? 0].name}!`;
  if (r.kind === "radar") return `Radar: ${squares} in that line`;
  if (r.kind === "seen") return "Flare: ship spotted!";
  if (r.kind === "clear") return "Flare: only water";
  if (r.kind === "dud") return "Torpedo ran off the edge";
  if (r.kind === "mine") return "Boom, a mine! One of the shooter's ships is now spotted";
  if (r.kind === "mine_seen") return "Flare: a mine (now harmless)";
  if (r.kind === "crate") {
    const item = ITEMS.find((i) => i.id === r.item);
    return `Supply crate: ${item ? `${item.icon} ${item.name}` : "a prize"}!`;
  }
  if (r.kind === "crate_seen") return "Flare: a supply crate";
  if (r.kind === "blocked") return "Blocked by a shield (a ship is there)";
  if (r.kind === "exposed") return "A ship square was spotted";
  if (r.kind === "repaired") return "Repaired a hit square";
  if (r.kind === "charged") return `Overdrive: ${POWERS[r.power ?? 0].name} is charged`;
  return `Ping: ${squares} nearby`;
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
      return markChar(m);
    })
    .join("");
  return { marks, sunk, pings: [...sea.pings], pings_left: sea.pingsLeft(), shots: sea.moves.length, all_sunk: sea.allSunk() };
}
