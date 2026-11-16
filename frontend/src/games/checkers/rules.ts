/**
 * Checkers rules (English draughts, 8×8). A line-for-line copy of
 * `backend/src/checkers/rules.rs`, checked against the same
 * `shared/checkers_vectors.json`. The server stays in charge of real games;
 * the browser uses this for move hints and same-device play.
 * Change both files together.
 *
 * Dark moves first from the top (squares 1–12) towards the bottom. Men move
 * one step diagonally forward, kings any diagonal. Captures are forced and
 * chain; men capture forward only; crowning ends the move. No legal move =
 * you lose. Draw after 80 quiet plies or a third repetition.
 */

export const SQUARES = 32;
/** 0 empty, 1 dark man, 2 dark king, -1 light man, -2 light king. */
export type Cells = number[];
export type Side = "dark" | "light";
export const QUIET_LIMIT = 80;
const DIRS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const other = (s: Side): Side => (s === "dark" ? "light" : "dark");
export const sign = (s: Side): number => (s === "dark" ? 1 : -1);

/** Row and column (0..8) of a playable square (0..32). */
export function rc(sq: number): [number, number] {
  const r = Math.trunc(sq / 4);
  const c = (sq % 4) * 2 + (r % 2 === 0 ? 1 : 0);
  return [r, c];
}

/** The playable square at (row, col), if it is one. */
export function sqAt(r: number, c: number): number | null {
  if (r < 0 || r >= 8 || c < 0 || c >= 8 || (r + c) % 2 === 0) return null;
  return r * 4 + Math.trunc(c / 2);
}

export interface Move {
  /** Squares visited, start first (0-based). */
  path: number[];
  /** Squares of the pieces taken (0-based). */
  captures: number[];
}

/** Standard notation with squares 1–32: "9-13" or "9x18x27". */
export const notation = (m: Move): string => m.path.map((s) => s + 1).join(m.captures.length === 0 ? "-" : "x");

/** "9x18x27" → [8, 17, 26]. Null if it isn't a list of squares 1–32. */
export function parsePath(s: string): number[] | null {
  const parts = s.split(/[-x]/);
  if (parts.length < 2) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 1 || n > 32) return null;
    out.push(n - 1);
  }
  return out;
}

export type Outcome = { kind: "ongoing" } | { kind: "win"; side: Side } | { kind: "draw" };

const key = (cells: Cells, turn: Side) => cells.join(",") + turn;

/** Men move (and capture) forward only: Dark down (+1 row), Light up. */
const canGo = (piece: number, dr: number) => Math.abs(piece) === 2 || dr === Math.sign(piece);
/** The row where a man of this colour is crowned. */
const kingRow = (piece: number) => (piece > 0 ? 7 : 0);

export class Game {
  cells: Cells;
  turn: Side;
  /** Plies since the last capture or man move. */
  quiet = 0;
  private history: string[];
  moves: Move[] = [];

  constructor(cells?: Cells, turn: Side = "dark") {
    this.cells = cells ? [...cells] : Array.from({ length: SQUARES }, (_, i) => (i < 12 ? 1 : i >= 20 ? -1 : 0));
    this.turn = turn;
    this.history = [key(this.cells, this.turn)];
  }

  clone(): Game {
    const g = new Game(this.cells, this.turn);
    g.quiet = this.quiet;
    g.history = [...this.history];
    g.moves = this.moves.map((m) => ({ path: [...m.path], captures: [...m.captures] }));
    return g;
  }

  /** Every legal move for the side to move (only captures if any exist). */
  legalMoves(): Move[] {
    const s = sign(this.turn);
    const jumps: Move[] = [];
    for (let sq = 0; sq < SQUARES; sq++) {
      const piece = this.cells[sq];
      if (piece * s > 0) {
        const board = [...this.cells];
        board[sq] = 0;
        jumpFrom(board, sq, piece, [sq], [], jumps);
      }
    }
    if (jumps.length > 0) return jumps;
    const out: Move[] = [];
    for (let sq = 0; sq < SQUARES; sq++) {
      const piece = this.cells[sq];
      if (piece * s <= 0) continue;
      const [r, c] = rc(sq);
      for (const [dr, dc] of DIRS) {
        if (!canGo(piece, dr)) continue;
        const t = sqAt(r + dr, c + dc);
        if (t !== null && this.cells[t] === 0) out.push({ path: [sq, t], captures: [] });
      }
    }
    return out;
  }

  /** Plays a move that `legalMoves` returned (not checked). */
  apply(m: Move): void {
    const from = m.path[0];
    const to = m.path[m.path.length - 1];
    let piece = this.cells[from];
    this.cells[from] = 0;
    for (const c of m.captures) this.cells[c] = 0;
    const man = Math.abs(piece) === 1;
    if (man && rc(to)[0] === kingRow(piece)) piece *= 2;
    this.cells[to] = piece;
    this.quiet = m.captures.length > 0 || man ? 0 : this.quiet + 1;
    this.turn = other(this.turn);
    this.history.push(key(this.cells, this.turn));
    this.moves.push(m);
  }

  /** Plays a move given as squares (0-based path); null if illegal. */
  playPath(path: number[]): Move | null {
    const m = this.legalMoves().find((x) => x.path.length === path.length && x.path.every((s, i) => s === path[i]));
    if (!m) return null;
    this.apply(m);
    return m;
  }

  outcome(): Outcome {
    if (this.legalMoves().length === 0) return { kind: "win", side: other(this.turn) };
    if (this.quiet >= QUIET_LIMIT) return { kind: "draw" };
    const now = this.history[this.history.length - 1];
    if (this.history.filter((h) => h === now).length >= 3) return { kind: "draw" };
    return { kind: "ongoing" };
  }

  moveString(): string {
    return this.moves.map(notation).join(" ");
  }

  /** Replays a stored move string from the start; null if a move is bad. */
  static replay(moves: string): Game | null {
    const g = new Game();
    for (const m of moves.split(/\s+/).filter(Boolean)) {
      if (g.outcome().kind !== "ongoing") return null;
      const path = parsePath(m);
      if (!path || !g.playPath(path)) return null;
    }
    return g;
  }

  /** Pieces left: [men, kings] of a side. */
  count(side: Side): [number, number] {
    const s = sign(side);
    let men = 0;
    let kings = 0;
    for (const c of this.cells) {
      if (c * s === 1) men++;
      else if (c * s === 2) kings++;
    }
    return [men, kings];
  }
}

/**
 * Depth-first search of every capture chain from `sq` (the moving piece is
 * already lifted off `board`; taken pieces stay until the move ends).
 */
function jumpFrom(board: Cells, sq: number, piece: number, path: number[], caps: number[], out: Move[]): void {
  const [r, c] = rc(sq);
  let found = false;
  for (const [dr, dc] of DIRS) {
    if (!canGo(piece, dr)) continue;
    const mid = sqAt(r + dr, c + dc);
    const land = sqAt(r + 2 * dr, c + 2 * dc);
    if (mid === null || land === null) continue;
    if (board[mid] * piece >= 0 || caps.includes(mid) || board[land] !== 0) continue;
    found = true;
    path.push(land);
    caps.push(mid);
    if (Math.abs(piece) === 1 && rc(land)[0] === kingRow(piece)) {
      // Crowned: the move ends here.
      out.push({ path: [...path], captures: [...caps] });
    } else {
      jumpFrom(board, land, piece, path, caps, out);
    }
    path.pop();
    caps.pop();
  }
  if (!found && path.length > 1) out.push({ path: [...path], captures: [...caps] });
}

/** Counts leaf positions `depth` plies ahead (for testing the rules). */
export function perft(g: Game, depth: number): number {
  if (depth === 0) return 1;
  const moves = g.legalMoves();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const next = g.clone();
    next.apply(m);
    n += perft(next, depth - 1);
  }
  return n;
}

/** A position as text: 32 chars (b B w W .) + " d" or " l". */
export function encode(cells: Cells, turn: Side): string {
  const ch: Record<number, string> = { 1: "b", 2: "B", [-1]: "w", [-2]: "W", 0: "." };
  return cells.map((c) => ch[c]).join("") + (turn === "dark" ? " d" : " l");
}

export function decode(s: string): { cells: Cells; turn: Side } | null {
  const [board, side] = s.split(" ");
  if (!board || board.length !== SQUARES || (side !== "d" && side !== "l")) return null;
  const val: Record<string, number> = { b: 1, B: 2, w: -1, W: -2, ".": 0 };
  const cells: Cells = [];
  for (const ch of board) {
    if (!(ch in val)) return null;
    cells.push(val[ch]);
  }
  return { cells, turn: side === "d" ? "dark" : "light" };
}
