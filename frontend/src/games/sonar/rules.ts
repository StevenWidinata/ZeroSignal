/**
 * Sonar rules: a line-for-line copy of backend/src/sonar/rules.rs, checked
 * against the same shared/sonar_vectors.json. The server stays in charge of
 * every real game; this copy powers placement checks and same-device play.
 * Tactics powers: see tactics.ts.
 */
import raw from "../../../../shared/sonar_rules.json";
import { SILENT_SHIP, Tactics, type Levels } from "./tactics";

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

/** What the shooter knows about a cell ("spotted" = a ship seen by a flare, not hit yet). */
export type Mark = "unknown" | "miss" | "hit" | { sunk: number } | "empty" | "spotted";

/** One letter per square, as the server sends it (see `Mark::ch` in rules.rs). */
export function markChar(m: Mark): string {
  if (typeof m === "object") return "s";
  return { unknown: ".", miss: "o", hit: "x", empty: "-", spotted: "*" }[m];
}

/** Squares you can still fire at. */
const isOpen = (m: Mark) => m === "unknown" || m === "spotted";

export type ShotResult =
  | { kind: "miss" }
  | { kind: "hit" }
  | { kind: "sunk"; ship: number }
  | { kind: "ping"; count: number }
  | { kind: "radar"; count: number }
  | { kind: "seen" }
  | { kind: "clear" }
  | { kind: "dud" };

/** Where a torpedo starts: l/r along a row, u (top) / d (bottom) along a column. */
export type Edge = "l" | "r" | "u" | "d";

/** Every move. Classic games only use fire and ping; the rest are Tactics powers. */
export type Move =
  | { kind: "fire" | "ping" | "flare"; cell: number }
  | { kind: "air_strike"; cell: number; horizontal: boolean }
  | { kind: "salvo"; cells: number[] }
  | { kind: "radar"; line: number; row: boolean }
  | { kind: "torpedo"; line: number; edge: Edge };

export function moveCode(m: Move): string {
  switch (m.kind) {
    case "fire":
      return `f${m.cell}`;
    case "ping":
      return `p${m.cell}`;
    case "flare":
      return `l${m.cell}`;
    case "air_strike":
      return `a${m.cell}${m.horizontal ? "h" : "v"}`;
    case "salvo":
      return `b${m.cells.join(".")}`;
    case "radar":
      return `${m.row ? "r" : "k"}${m.line}`;
    case "torpedo":
      return `t${m.line}${m.edge}`;
  }
}

export function parseMove(s: string): Move | null {
  const k = s[0];
  const rest = s.slice(1);
  const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : null);
  const cell = (t: string) => {
    const n = num(t);
    return n !== null && n < CELLS ? n : null;
  };
  const line = (t: string) => {
    const n = num(t);
    return n !== null && n < SIZE ? n : null;
  };
  if (k === "f" || k === "p" || k === "l") {
    const c = cell(rest);
    return c === null ? null : { kind: k === "f" ? "fire" : k === "p" ? "ping" : "flare", cell: c };
  }
  if (k === "r" || k === "k") {
    const l = line(rest);
    return l === null ? null : { kind: "radar", line: l, row: k === "r" };
  }
  if ((k === "a" || k === "t") && rest.length > 0) {
    const n = rest.slice(0, -1);
    const d = rest.slice(-1);
    if (k === "a") {
      const c = cell(n);
      return c === null || (d !== "h" && d !== "v") ? null : { kind: "air_strike", cell: c, horizontal: d === "h" };
    }
    const l = line(n);
    return l === null || !["l", "r", "u", "d"].includes(d) ? null : { kind: "torpedo", line: l, edge: d as Edge };
  }
  if (k === "b") {
    const parts = rest.split(".");
    if (parts.length < 2 || parts.length > 3) return null;
    const cells = parts.map(cell);
    return cells.some((c) => c === null) ? null : { kind: "salvo", cells: cells as number[] };
  }
  return null;
}

/** The Tactics power a move uses (fleet index of its ship), or null. */
export function movePower(m: Move): number | null {
  const i = ["air_strike", "salvo", "radar", "torpedo", "flare"].indexOf(m.kind);
  return i === -1 ? null : i;
}

/** The squares of row `line` (`row`) or column `line`, in order. */
export function lineCells(line: number, row: boolean): number[] {
  return Array.from({ length: SIZE }, (_, k) => (row ? line * SIZE + k : k * SIZE + line));
}

/** The squares a torpedo runs through, in order. */
export function torpedoPath(line: number, edge: Edge): number[] {
  const v = lineCells(line, edge === "l" || edge === "r");
  return edge === "r" || edge === "d" ? v.reverse() : v;
}

/** The squares a flare lights: a + shape (size 5) or the 3×3 area (size 9), clipped. */
export function flareArea(center: number, size: number): number[] {
  if (size >= 9) return pingArea(center);
  const r = Math.floor(center / SIZE);
  const c = center % SIZE;
  return [...neighbours(center).filter((n) => Math.floor(n / SIZE) === r || n % SIZE === c), center].sort((a, b) => a - b);
}

/** The square a move is shown at (a ping's centre, a line's first square). */
export function moveCell(m: Move): number {
  if (m.kind === "salvo") return m.cells[0];
  if (m.kind === "radar") return lineCells(m.line, m.row)[0];
  if (m.kind === "torpedo") return torpedoPath(m.line, m.edge)[0];
  return m.cell;
}

export function shortResult(r: ShotResult): string {
  if (r.kind === "sunk") return `sunk:${FLEET[r.ship].id}`;
  if (r.kind === "ping" || r.kind === "radar") return `${r.kind}:${r.count}`;
  return r.kind;
}

const WEIGHT: Record<ShotResult["kind"], number> = { sunk: 5, hit: 4, seen: 3, ping: 2, radar: 2, clear: 1, miss: 1, dud: 0 };

/** The result that matters most (a sinking beats a hit beats a miss). */
export function mainResult(results: [number, ShotResult][]): ShotResult {
  let best: ShotResult = { kind: "miss" };
  let w = -1;
  for (const [, r] of results)
    if (WEIGHT[r.kind] > w) {
      best = r;
      w = WEIGHT[r.kind];
    }
  return best;
}

export type ShotError = "bad_move" | "already_known" | "no_pings_left" | "over" | "not_tactics" | "not_ready" | "power_lost";

export const SHOT_ERROR_TEXT: Record<ShotError, string> = {
  bad_move: "That isn't a square on the grid.",
  already_known: "You already know what's there.",
  no_pings_left: "No sonar pings left.",
  over: "This game is over.",
  not_tactics: "Ship powers are only in Tactics games.",
  not_ready: "That power is still charging.",
  power_lost: "That ship has sunk, so its power is gone.",
};

/** One side's sea as the other side fires at it. */
export class Sea {
  readonly occ: number[];
  marks: Mark[] = new Array<Mark>(CELLS).fill("unknown");
  hits: number[] = FLEET.map(() => 0);
  pings: { center: number; count: number }[] = [];
  /** Tactics: radar sweeps so far. */
  sweeps: { line: number; row: boolean; count: number }[] = [];
  /** Tactics: this ship doesn't show in pings or radar while afloat. */
  readonly silent: number | null;
  moves: string[] = [];

  constructor(ships: Placement[], tactics = false) {
    this.occ = occupancy(ships);
    this.silent = tactics ? SILENT_SHIP : null;
  }

  pingsLeft(): number {
    return Math.max(0, RULES.pings - this.pings.length);
  }

  allSunk(): boolean {
    return this.hits.every((h, i) => h === FLEET[i].len);
  }

  isSunk(ship: number): boolean {
    return this.hits[ship] === FLEET[ship].len;
  }

  /** Ship squares in `cells` that pings and radar can hear (a silent sub can't be heard). */
  private heard(cells: number[]): number {
    return cells.filter((c) => {
      const s = this.occ[c];
      return s !== -1 && (this.silent !== s || this.isSunk(s));
    }).length;
  }

  private fireAt(cell: number): ShotResult {
    const ship = this.occ[cell];
    if (ship === -1) {
      this.marks[cell] = "miss";
      return { kind: "miss" };
    }
    this.hits[ship]++;
    this.marks[cell] = "hit";
    if (this.hits[ship] < FLEET[ship].len) return { kind: "hit" };
    for (let c = 0; c < CELLS; c++) if (this.occ[c] === ship) this.marks[c] = { sunk: ship };
    for (let c = 0; c < CELLS; c++) if (this.occ[c] === ship) for (const n of neighbours(c)) if (this.marks[n] === "unknown") this.marks[n] = "empty";
    return { kind: "sunk", ship };
  }

  /** Play a classic move (a shot or a ping). */
  play(m: Move): ShotResult | ShotError {
    if (movePower(m) !== null) return "not_tactics";
    const r = this.strike(m, 0);
    return isError(r) ? r : r[0][1];
  }

  /**
   * Play any move; `size` is the power's size at the shooter's Mk level.
   * Checks everything before changing anything, then returns [square, result]
   * for each square the move touched (like `Sea::strike` in rules.rs).
   */
  strike(m: Move, size: number): [number, ShotResult][] | ShotError {
    if (this.allSunk()) return "over";
    let out: [number, ShotResult][];
    switch (m.kind) {
      case "fire": {
        if (m.cell < 0 || m.cell >= CELLS) return "bad_move";
        if (!isOpen(this.marks[m.cell])) return "already_known";
        out = [[m.cell, this.fireAt(m.cell)]];
        break;
      }
      case "ping": {
        if (m.cell < 0 || m.cell >= CELLS) return "bad_move";
        if (this.pingsLeft() === 0) return "no_pings_left";
        const count = this.heard(pingArea(m.cell));
        this.pings.push({ center: m.cell, count });
        out = [[m.cell, { kind: "ping", count }]];
        break;
      }
      case "air_strike": {
        const cells = shipCells({ bow: m.cell, horizontal: m.horizontal }, size);
        if (!cells) return "bad_move";
        if (!cells.some((c) => isOpen(this.marks[c]))) return "already_known";
        out = [];
        // A sinking can turn a later square into known water: skip it then.
        for (const c of cells) if (isOpen(this.marks[c])) out.push([c, this.fireAt(c)]);
        break;
      }
      case "salvo": {
        if (m.cells.length !== size) return "bad_move";
        if (m.cells.some((c, i) => m.cells.indexOf(c) !== i)) return "bad_move";
        if (m.cells.some((c) => !isOpen(this.marks[c]))) return "already_known";
        out = [];
        for (const c of m.cells) if (isOpen(this.marks[c])) out.push([c, this.fireAt(c)]);
        break;
      }
      case "radar": {
        const cells = lineCells(m.line, m.row);
        const count = this.heard(cells);
        this.sweeps.push({ line: m.line, row: m.row, count });
        out = [[cells[0], { kind: "radar", count }]];
        break;
      }
      case "torpedo": {
        const path = torpedoPath(m.line, m.edge);
        const c = path.find((x) => this.occ[x] !== -1 && isOpen(this.marks[x]));
        out = c === undefined ? [[path[SIZE - 1], { kind: "dud" }]] : [[c, this.fireAt(c)]];
        break;
      }
      case "flare": {
        const area = flareArea(m.cell, size);
        if (!area.some((c) => this.marks[c] === "unknown")) return "already_known";
        out = [];
        for (const c of area) {
          if (this.marks[c] !== "unknown") continue;
          if (this.occ[c] !== -1) {
            this.marks[c] = "spotted";
            out.push([c, { kind: "seen" }]);
          } else {
            this.marks[c] = "empty";
            out.push([c, { kind: "clear" }]);
          }
        }
        break;
      }
    }
    this.moves.push(moveCode(m));
    return out;
  }
}

export const isError = <T>(r: T | ShotError): r is ShotError => typeof r === "string";

/** One move in a duel and what it did, square by square. */
export interface Turn {
  side: 0 | 1;
  move: Move;
  results: [number, ShotResult][];
  /** The headline result (see `mainResult`). */
  result: ShotResult;
}

/**
 * Two sides firing in turn (like `Duel` in rules.rs). Side 0 and side 1;
 * `first` moves first. Whose turn it is comes from the moves played, not from
 * counting them, so a move can later grant an extra turn. seas[s] is side s's
 * own sea. A Tactics duel (`tactics` set) also allows ship powers.
 */
export class Duel {
  readonly seas: [Sea, Sea];
  readonly tactics: Tactics | null;
  log: Turn[] = [];
  private next: 0 | 1;

  /** `levels` (each side's power Mk levels) makes it a Tactics duel. */
  constructor(fleets: [Placement[], Placement[]], first: 0 | 1, levels: [Levels, Levels] | null = null) {
    this.seas = [new Sea(fleets[0], !!levels), new Sea(fleets[1], !!levels)];
    this.tactics = levels ? new Tactics(levels) : null;
    this.next = first;
  }

  /** Replay a move list ("f37 p44 …"); the first bad move is returned as an error. */
  static replay(fleets: [Placement[], Placement[]], first: 0 | 1, moves: string, levels: [Levels, Levels] | null = null): Duel | ShotError {
    const d = new Duel(fleets, first, levels);
    for (const t of moves.split(/\s+/).filter(Boolean)) {
      const m = parseMove(t);
      if (!m) return "bad_move";
      const r = d.play(m);
      if (isError(r)) return r;
    }
    return d;
  }

  toMove(): 0 | 1 {
    return this.next;
  }

  /** The side that sank the other fleet, if any. */
  winner(): 0 | 1 | null {
    if (this.seas[1].allSunk()) return 0;
    if (this.seas[0].allSunk()) return 1;
    return null;
  }

  /** Why `side` can't use `power` now (null = it can). */
  powerProblem(side: 0 | 1, power: number): ShotError | null {
    if (!this.tactics) return "not_tactics";
    if (this.seas[side].isSunk(power)) return "power_lost";
    if (!this.tactics.ready(side, power)) return "not_ready";
    return null;
  }

  /** Play the next move; returns its headline result. */
  play(m: Move): ShotResult | ShotError {
    if (this.winner() !== null) return "over";
    const side = this.next;
    const power = movePower(m);
    let size = 0;
    if (power !== null) {
      const problem = this.powerProblem(side, power);
      if (problem) return problem;
      size = this.tactics!.spec(side, power).size;
      if (m.kind === "torpedo" && size < 4 && (m.edge === "r" || m.edge === "d")) return "bad_move";
    }
    const results = this.seas[1 - side].strike(m, size);
    if (isError(results)) return results;
    this.tactics?.afterMove(side, power);
    const result = mainResult(results);
    this.log.push({ side, move: m, results, result });
    this.next = (1 - side) as 0 | 1;
    return result;
  }

  moveString(): string {
    return this.log.map((l) => moveCode(l.move)).join(" ");
  }
}
