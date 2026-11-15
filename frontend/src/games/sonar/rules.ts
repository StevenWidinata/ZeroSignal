/**
 * Sonar rules: a line-for-line copy of backend/src/sonar/rules.rs, checked
 * against the same shared/sonar_vectors.json. The server stays in charge of
 * every real game; this copy powers placement checks and same-device play.
 */
import raw from "../../../../shared/sonar_rules.json";

export interface ShipSpec {
  id: string;
  name: string;
  len: number;
}

export const RULES = raw as { size: number; pings: number; fleet: ShipSpec[] };
export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const FLEET = RULES.fleet;

export type FleetError = "bad_code" | "wrong_count" | "off_grid" | "overlap" | "touching";

export const FLEET_ERROR_TEXT: Record<FleetError, string> = {
  bad_code: "That isn't a fleet.",
  wrong_count: "Place all 5 ships.",
  off_grid: "A ship sticks out of the grid.",
  overlap: "Two ships overlap.",
  touching: "Ships can't touch, not even corner to corner.",
};

/** "c7" -> 62. */
export function parseCell(s: string): number | null {
  const col = s[0];
  if (!col || col < "a" || col > "j") return null;
  const rest = s.slice(1);
  if (!/^[1-9]\d*$/.test(rest)) return null;
  const row = Number(rest);
  if (row < 1 || row > SIZE) return null;
  return (row - 1) * SIZE + (col.charCodeAt(0) - 97);
}

/** 62 -> "c7". */
export function cellName(cell: number): string {
  return `${String.fromCharCode(97 + (cell % SIZE))}${Math.floor(cell / SIZE) + 1}`;
}

export interface Placement {
  bow: number;
  horizontal: boolean;
}

export function shipCells(p: Placement, len: number): number[] | null {
  const r = Math.floor(p.bow / SIZE);
  const c = p.bow % SIZE;
  if (p.bow < 0 || p.bow >= CELLS || (p.horizontal && c + len > SIZE) || (!p.horizontal && r + len > SIZE)) return null;
  return Array.from({ length: len }, (_, k) => (p.horizontal ? p.bow + k : p.bow + k * SIZE));
}

/** The up-to-8 cells around a cell. */
export function neighbours(cell: number): number[] {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) out.push(rr * SIZE + cc);
    }
  return out;
}

/** The 3×3 area a ping covers (clipped at the edges). */
export function pingArea(center: number): number[] {
  return [...neighbours(center), center].sort((a, b) => a - b);
}

export function parseFleet(code: string): { ships: Placement[] } | { error: FleetError } {
  const tokens = code.split(/\s+/).filter(Boolean);
  const ships: Placement[] = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    const dir = t.slice(-1);
    if (dir !== "h" && dir !== "v") return { error: "bad_code" };
    const bow = parseCell(t.slice(0, -1));
    if (bow === null) return { error: "bad_code" };
    ships.push({ bow, horizontal: dir === "h" });
  }
  const error = validateFleet(ships);
  return error ? { error } : { ships };
}

export function fleetCode(ships: Placement[]): string {
  return ships.map((p) => `${cellName(p.bow)}${p.horizontal ? "h" : "v"}`).join(" ");
}

/** null = a legal fleet. With `partial`, checks only the ships given so far. */
export function validateFleet(ships: (Placement | null)[], partial = false): FleetError | null {
  if (!partial && ships.length !== FLEET.length) return "wrong_count";
  const all: (number[] | null)[] = [];
  for (let i = 0; i < ships.length; i++) {
    const p = ships[i];
    if (!p) {
      if (partial) {
        all.push(null);
        continue;
      }
      return "wrong_count";
    }
    const cells = shipCells(p, FLEET[i].len);
    if (!cells) return "off_grid";
    all.push(cells);
  }
  const owner = new Array<number>(CELLS).fill(-1);
  for (let i = 0; i < all.length; i++)
    for (const c of all[i] ?? []) {
      if (owner[c] !== -1) return "overlap";
      owner[c] = i;
    }
  for (let i = 0; i < all.length; i++)
    for (const c of all[i] ?? []) for (const n of neighbours(c)) if (owner[n] !== -1 && owner[n] !== i) return "touching";
  return null;
}

/** Which ship is on each cell (-1 = water). */
export function occupancy(ships: (Placement | null)[]): number[] {
  const occ = new Array<number>(CELLS).fill(-1);
  ships.forEach((p, i) => {
    if (p) for (const c of shipCells(p, FLEET[i].len) ?? []) occ[c] = i;
  });
  return occ;
}

/** A random legal fleet ("Shuffle"). */
export function randomFleet(rand: () => number = Math.random): Placement[] {
  for (;;) {
    const ships: Placement[] = [];
    let ok = true;
    for (const spec of FLEET) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const p = { bow: Math.floor(rand() * CELLS), horizontal: rand() < 0.5 };
        if (!shipCells(p, spec.len)) continue;
        ships.push(p);
        if (validateFleet(ships, true) === null) placed = true;
        else ships.pop();
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships;
  }
}

/** What the shooter knows about a cell. */
export type Mark = "unknown" | "miss" | "hit" | { sunk: number } | "empty";

export type ShotResult = { kind: "miss" } | { kind: "hit" } | { kind: "sunk"; ship: number } | { kind: "ping"; count: number };

export type Move = { kind: "fire" | "ping"; cell: number };

export const moveCode = (m: Move) => `${m.kind === "fire" ? "f" : "p"}${m.cell}`;

export function parseMove(s: string): Move | null {
  const k = s[0];
  const n = Number(s.slice(1));
  if (!/^\d+$/.test(s.slice(1)) || n >= CELLS) return null;
  if (k === "f") return { kind: "fire", cell: n };
  if (k === "p") return { kind: "ping", cell: n };
  return null;
}

export function shortResult(r: ShotResult): string {
  if (r.kind === "sunk") return `sunk:${FLEET[r.ship].id}`;
  if (r.kind === "ping") return `ping:${r.count}`;
  return r.kind;
}

export type ShotError = "bad_move" | "already_known" | "no_pings_left" | "over";

/** One side's sea as the other side fires at it. */
export class Sea {
  readonly occ: number[];
  marks: Mark[] = new Array<Mark>(CELLS).fill("unknown");
  hits: number[] = FLEET.map(() => 0);
  pings: { center: number; count: number }[] = [];
  moves: string[] = [];

  constructor(ships: Placement[]) {
    this.occ = occupancy(ships);
  }

  pingsLeft(): number {
    return Math.max(0, RULES.pings - this.pings.length);
  }

  allSunk(): boolean {
    return this.hits.every((h, i) => h === FLEET[i].len);
  }

  play(m: Move): ShotResult | ShotError {
    if (this.allSunk()) return "over";
    if (m.cell < 0 || m.cell >= CELLS) return "bad_move";
    let r: ShotResult;
    if (m.kind === "ping") {
      if (this.pingsLeft() === 0) return "no_pings_left";
      const count = pingArea(m.cell).filter((c) => this.occ[c] !== -1).length;
      this.pings.push({ center: m.cell, count });
      r = { kind: "ping", count };
    } else {
      if (this.marks[m.cell] !== "unknown") return "already_known";
      const ship = this.occ[m.cell];
      if (ship === -1) {
        this.marks[m.cell] = "miss";
        r = { kind: "miss" };
      } else {
        this.hits[ship]++;
        this.marks[m.cell] = "hit";
        if (this.hits[ship] === FLEET[ship].len) {
          for (let c = 0; c < CELLS; c++) if (this.occ[c] === ship) this.marks[c] = { sunk: ship };
          for (let c = 0; c < CELLS; c++)
            if (this.occ[c] === ship) for (const n of neighbours(c)) if (this.marks[n] === "unknown") this.marks[n] = "empty";
          r = { kind: "sunk", ship };
        } else r = { kind: "hit" };
      }
    }
    this.moves.push(moveCode(m));
    return r;
  }
}

export const isError = (r: ShotResult | ShotError): r is ShotError => typeof r === "string";
