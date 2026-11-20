/**
 * Sonar rules: a line-for-line copy of backend/src/sonar/rules.rs, checked
 * against the same shared/sonar_vectors.json. The server stays in charge of
 * every real game; this copy powers placement checks and same-device play.
 * Tactics powers: see tactics.ts.
 */
import raw from "../../../../shared/sonar_rules.json";
import { Rng } from "../../platform/seeded";
import { MINES, POWERS, SILENT_SHIP, Tactics, type Item, type Setup } from "./tactics";

export interface ShipSpec {
  id: string;
  name: string;
  len: number;
}

export const RULES = raw as { size: number; pings: number; fleet: ShipSpec[] };
export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const FLEET = RULES.fleet;

export type FleetError = "bad_code" | "wrong_count" | "off_grid" | "overlap" | "touching" | "bad_mine" | "too_many_mines";

export const FLEET_ERROR_TEXT: Record<FleetError, string> = {
  bad_code: "That isn't a fleet.",
  wrong_count: "Place all 5 ships.",
  off_grid: "A ship sticks out of the grid.",
  overlap: "Two ships overlap.",
  touching: "Ships can't touch, not even corner to corner.",
  bad_mine: "Mines go on open water, not on or next to a ship.",
  too_many_mines: "Too many mines.",
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

/** A fleet: ships in FLEET order, plus (Tactics) up to 2 mines written "… mc7 mh2". */
export interface Fleet {
  ships: Placement[];
  mines: number[];
}

export function parseFleet(code: string): Fleet | { error: FleetError } {
  const tokens = code.split(/\s+/).filter(Boolean);
  const ships: Placement[] = [];
  const mines: number[] = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if (t.startsWith("m")) {
      const m = parseCell(t.slice(1));
      if (m === null) return { error: "bad_code" };
      mines.push(m);
      continue;
    }
    // Mines come after all the ships.
    if (mines.length) return { error: "bad_code" };
    const dir = t.slice(-1);
    if (dir !== "h" && dir !== "v") return { error: "bad_code" };
    const bow = parseCell(t.slice(0, -1));
    if (bow === null) return { error: "bad_code" };
    ships.push({ bow, horizontal: dir === "h" });
  }
  const error = validateFleet(ships) ?? validateMines(ships, mines);
  return error ? { error } : { ships, mines };
}

export function fleetCode(ships: Placement[], mines: number[] = []): string {
  return [...ships.map((p) => `${cellName(p.bow)}${p.horizontal ? "h" : "v"}`), ...mines.map((m) => `m${cellName(m)}`)].join(" ");
}

/** null = the mines are fine: at most MINES, on open water, not next to a ship, no two on one square. */
export function validateMines(ships: (Placement | null)[], mines: number[]): FleetError | null {
  if (mines.length > MINES) return "too_many_mines";
  const occ = occupancy(ships);
  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (m < 0 || m >= CELLS || occ[m] !== -1 || neighbours(m).some((n) => occ[n] !== -1) || mines.indexOf(m) !== i) return "bad_mine";
  }
  return null;
}

/** The seed that hides sea `side`'s crates (like `crate_seed` in tactics.rs). */
export const crateSeed = (seed: number, side: number) => (seed ^ (0xc8a7e5a1 + side)) >>> 0;

const ITEM_ORDER: Item[] = ["ping", "shield", "repair", "extra_shot"];

/** Hide `n` crates on open water, not next to a ship, not on a mine (like `hide_crates` in tactics.rs). */
export function hideCrates(fleet: Fleet, seed: number, n: number): [number, Item][] {
  const occ = occupancy(fleet.ships);
  const spots: number[] = [];
  for (let c = 0; c < CELLS; c++) if (occ[c] === -1 && neighbours(c).every((x) => occ[x] === -1) && !fleet.mines.includes(c)) spots.push(c);
  const rng = new Rng(seed);
  const out: [number, Item][] = [];
  for (let i = 0; i < n && spots.length; i++) {
    const cell = spots.splice(rng.below(spots.length), 1)[0];
    out.push([cell, ITEM_ORDER[rng.below(ITEM_ORDER.length)]]);
  }
  return out;
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

/**
 * What the shooter knows about a cell. Tactics adds "spotted" (a ship seen by
 * a flare, a mine or a shield, not hit yet), "mine" (found, harmless now),
 * "crate_seen" (a crate seen by a flare, still to shoot) and "crate" (opened).
 */
export type Mark = "unknown" | "miss" | "hit" | { sunk: number } | "empty" | "spotted" | "mine" | "crate_seen" | "crate";

/** One letter per square, as the server sends it (see `Mark::ch` in rules.rs). */
export function markChar(m: Mark): string {
  if (typeof m === "object") return "s";
  return { unknown: ".", miss: "o", hit: "x", empty: "-", spotted: "*", mine: "m", crate_seen: "+", crate: "c" }[m];
}

/** Squares you can still fire at. */
const isOpen = (m: Mark) => m === "unknown" || m === "spotted" || m === "crate_seen";

export type ShotResult =
  | { kind: "miss" }
  | { kind: "hit" }
  | { kind: "sunk"; ship: number }
  | { kind: "ping"; count: number }
  | { kind: "radar"; count: number }
  | { kind: "seen" }
  | { kind: "clear" }
  | { kind: "dud" }
  | { kind: "mine" }
  | { kind: "mine_seen" }
  | { kind: "crate"; item: Item }
  | { kind: "crate_seen" }
  | { kind: "blocked" }
  | { kind: "exposed" }
  | { kind: "repaired" }
  | { kind: "charged"; power: number };

/** Where a torpedo starts: l/r along a row, u (top) / d (bottom) along a column. */
export type Edge = "l" | "r" | "u" | "d";

/** Every move. Classic games only use fire and ping; the rest are Tactics powers. */
export type Move =
  | { kind: "fire" | "ping" | "flare"; cell: number }
  | { kind: "air_strike"; cell: number; horizontal: boolean }
  | { kind: "salvo"; cells: number[] }
  | { kind: "radar"; line: number; row: boolean }
  | { kind: "torpedo"; line: number; edge: Edge }
  | { kind: "overdrive"; power: number };

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
    case "overdrive":
      return `o${m.power}`;
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
  if (k === "o") {
    const p = num(rest);
    return p === null || p >= POWERS.length ? null : { kind: "overdrive", power: p };
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

/** Moves that fire shots (they count for combos). */
export const moveFires = (m: Move) => m.kind === "fire" || m.kind === "air_strike" || m.kind === "salvo" || m.kind === "torpedo";

/** The square a move is shown at (a ping's centre, a line's first square). */
export function moveCell(m: Move): number {
  if (m.kind === "overdrive") return 0;
  if (m.kind === "salvo") return m.cells[0];
  if (m.kind === "radar") return lineCells(m.line, m.row)[0];
  if (m.kind === "torpedo") return torpedoPath(m.line, m.edge)[0];
  return m.cell;
}

export function shortResult(r: ShotResult): string {
  if (r.kind === "sunk") return `sunk:${FLEET[r.ship].id}`;
  if (r.kind === "ping" || r.kind === "radar") return `${r.kind}:${r.count}`;
  if (r.kind === "crate") return `crate:${r.item}`;
  if (r.kind === "charged") return `charged:${POWERS[r.power].id}`;
  return r.kind;
}

/** Hit or sunk: counts for a combo. */
export const struck = (r: ShotResult) => r.kind === "hit" || r.kind === "sunk";

const WEIGHT: Record<ShotResult["kind"], number> = {
  sunk: 6,
  hit: 5,
  crate: 4,
  mine: 4,
  blocked: 3,
  seen: 3,
  crate_seen: 3,
  mine_seen: 3,
  ping: 2,
  radar: 2,
  charged: 2,
  clear: 1,
  miss: 1,
  dud: 0,
  exposed: 0,
  repaired: 0,
};

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

export type ShotError =
  | "bad_move"
  | "already_known"
  | "no_pings_left"
  | "over"
  | "not_tactics"
  | "not_ready"
  | "power_lost"
  | "no_overdrive"
  | "already_ready";

export const SHOT_ERROR_TEXT: Record<ShotError, string> = {
  bad_move: "That isn't a square on the grid.",
  already_known: "You already know what's there.",
  no_pings_left: "No sonar pings left.",
  over: "This game is over.",
  not_tactics: "Ship powers are only in Tactics games.",
  not_ready: "That power is still charging.",
  power_lost: "That ship has sunk, so its power is gone.",
  no_overdrive: "Overdrive isn't full yet.",
  already_ready: "That power is already charged.",
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
  /** Tactics: mines still armed. */
  private mines: number[];
  /** Tactics: hidden supply crates not opened yet. */
  private crates: [number, Item][];
  /** Tactics: extra pings the shooter found in crates in this sea. */
  bonusPings = 0;
  /** Tactics: shields guarding this sea's ships. */
  shields = 0;
  moves: string[] = [];

  /** `tactics` (mines and hidden crates) makes it a Tactics sea, where the sub also runs silent. */
  constructor(ships: Placement[], tactics: { mines: number[]; crates: [number, Item][] } | null = null) {
    this.occ = occupancy(ships);
    this.silent = tactics ? SILENT_SHIP : null;
    this.mines = tactics ? [...tactics.mines] : [];
    this.crates = tactics ? [...tactics.crates] : [];
  }

  pingsLeft(): number {
    return Math.max(0, RULES.pings + this.bonusPings - this.pings.length);
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
    const mine = this.mines.indexOf(cell);
    if (mine !== -1) {
      this.mines.splice(mine, 1);
      this.marks[cell] = "mine";
      return { kind: "mine" };
    }
    const crate = this.crates.findIndex(([c]) => c === cell);
    if (crate !== -1) {
      const [, item] = this.crates.splice(crate, 1)[0];
      this.marks[cell] = "crate";
      return { kind: "crate", item };
    }
    const ship = this.occ[cell];
    if (ship === -1) {
      this.marks[cell] = "miss";
      return { kind: "miss" };
    }
    if (this.shields > 0) {
      this.shields--;
      this.marks[cell] = "spotted";
      return { kind: "blocked" };
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
          const mine = this.mines.indexOf(c);
          if (this.occ[c] !== -1) {
            this.marks[c] = "spotted";
            out.push([c, { kind: "seen" }]);
          } else if (mine !== -1) {
            this.mines.splice(mine, 1);
            this.marks[c] = "mine";
            out.push([c, { kind: "mine_seen" }]);
          } else if (this.crates.some(([x]) => x === c)) {
            this.marks[c] = "crate_seen";
            out.push([c, { kind: "crate_seen" }]);
          } else {
            this.marks[c] = "empty";
            out.push([c, { kind: "clear" }]);
          }
        }
        break;
      }
      case "overdrive":
        return "bad_move";
    }
    this.moves.push(moveCode(m));
    return out;
  }

  /** A mine went off: show one ship square the other side doesn't know yet (`pick(n)` chooses 0..n). */
  expose(pick: (n: number) => number): number | null {
    const hidden: number[] = [];
    for (let c = 0; c < CELLS; c++) if (this.occ[c] !== -1 && this.marks[c] === "unknown") hidden.push(c);
    if (!hidden.length) return null;
    const c = hidden[pick(hidden.length)];
    this.marks[c] = "spotted";
    return c;
  }

  /** A repair kit: fix the first hit square (back to "spotted"), or null if no ship afloat is hit. */
  repair(): number | null {
    const c = this.marks.indexOf("hit");
    if (c === -1) return null;
    this.hits[this.occ[c]]--;
    this.marks[c] = "spotted";
    return c;
  }
}

export const isError = <T>(r: T | ShotError): r is ShotError => typeof r === "string";

/** One move in a duel and what it did, square by square. */
export interface Turn {
  side: 0 | 1;
  move: Move;
  /** What happened in the other side's sea. */
  results: [number, ShotResult][];
  /** Tactics: what happened in the mover's own sea (a mine showed a ship square, a repair kit fixed one). */
  own: [number, ShotResult][];
  /** The headline result (see `mainResult`). */
  result: ShotResult;
}

/**
 * Two sides firing in turn (like `Duel` in rules.rs). Side 0 and side 1;
 * `first` moves first. Every move passes the turn, except in Tactics an Extra
 * shot crate and spending Overdrive. seas[s] is side s's own sea. A Tactics
 * duel (`tactics` set) also has powers, mines and crates.
 */
export class Duel {
  readonly seas: [Sea, Sea];
  readonly tactics: Tactics | null;
  log: Turn[] = [];
  private next: 0 | 1;
  private readonly seed: number;

  /** `setup` makes it a Tactics duel (Classic ignores the fleets' mines). */
  constructor(fleets: [Fleet, Fleet], first: 0 | 1, setup: Setup | null = null) {
    const sea = (s: number) =>
      new Sea(fleets[s].ships, setup ? { mines: fleets[s].mines, crates: hideCrates(fleets[s], crateSeed(setup.seed, s), setup.crates) } : null);
    this.seas = [sea(0), sea(1)];
    this.tactics = setup ? new Tactics(setup.levels) : null;
    this.seed = setup?.seed ?? 0;
    this.next = first;
  }

  /** Replay a move list ("f37 p44 …"); the first bad move is returned as an error. */
  static replay(fleets: [Fleet, Fleet], first: 0 | 1, moves: string, setup: Setup | null = null): Duel | ShotError {
    const d = new Duel(fleets, first, setup);
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
    if (m.kind === "overdrive") {
      const t = this.tactics;
      if (!t) return "not_tactics";
      if (!t.overdrive[side]) return "no_overdrive";
      if (this.seas[side].isSunk(m.power)) return "power_lost";
      if (t.ready(side, m.power)) return "already_ready";
      t.spendOverdrive(side, m.power);
      const r: ShotResult = { kind: "charged", power: m.power };
      // A free action: the turn stays.
      this.log.push({ side, move: m, results: [[0, r]], own: [], result: r });
      return r;
    }
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
    const own: [number, ShotResult][] = [];
    let extraTurn = false;
    for (const [, r] of results) {
      if (r.kind === "mine") {
        const rng = new Rng((this.seed ^ (0x5eed0000 + this.log.length)) >>> 0);
        const c = this.seas[side].expose((n) => rng.below(n));
        if (c !== null) own.push([c, { kind: "exposed" }]);
      } else if (r.kind === "crate") {
        if (r.item === "ping") this.seas[1 - side].bonusPings++;
        else if (r.item === "shield") this.seas[side].shields++;
        else if (r.item === "repair") {
          const c = this.seas[side].repair();
          if (c === null) this.seas[side].shields++;
          else own.push([c, { kind: "repaired" }]);
        } else extraTurn = true;
      }
    }
    if (this.tactics) {
      this.tactics.afterMove(side, power);
      if (moveFires(m)) this.tactics.afterFiring(side, results.some(([, r]) => struck(r)));
    }
    const result = mainResult(results);
    this.log.push({ side, move: m, results, own, result });
    this.next = extraTurn ? side : ((1 - side) as 0 | 1);
    return result;
  }

  moveString(): string {
    return this.log.map((l) => moveCode(l.move)).join(" ");
  }
}
