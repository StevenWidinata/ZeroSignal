/**
 * Sudoku helpers that only look at what's on screen (never the solution):
 * grids as 81 numbers (0 = empty), peers, numbers that clash, how many of
 * each number are placed, notes (pencil marks) and cursor moves.
 */

export const CELLS = 81;

export const row = (c: number) => Math.floor(c / 9);
export const col = (c: number) => c % 9;
export const box = (c: number) => Math.floor(c / 27) * 3 + Math.floor((c % 9) / 3);

/** Do two squares share a row, column or box? */
export const sameUnit = (a: number, b: number) => row(a) === row(b) || col(a) === col(b) || box(a) === box(b);

/** The 20 other squares that share a row, column or box with `c`. */
export const PEERS: number[][] = Array.from({ length: CELLS }, (_, c) =>
  Array.from({ length: CELLS }, (_, o) => o).filter((o) => o !== c && sameUnit(o, c)),
);

/** "53..7…" → [5, 3, 0, 0, 7, …]. */
export function parseGrid(s: string): number[] {
  return Array.from({ length: CELLS }, (_, i) => {
    const ch = s[i];
    return ch && ch >= "1" && ch <= "9" ? Number(ch) : 0;
  });
}

export const gridCode = (g: number[]) => g.map((v) => (v ? String(v) : ".")).join("");

export const isFull = (g: number[]) => g.every((v) => v !== 0);

/** Squares whose number appears twice in one of their units. */
export function clashes(g: number[]): Set<number> {
  const bad = new Set<number>();
  for (let c = 0; c < CELLS; c++) {
    if (!g[c]) continue;
    for (const p of PEERS[c]) if (g[p] === g[c]) bad.add(c);
  }
  return bad;
}

/** How many of each number (index 1–9) are on the grid. */
export function counts(g: number[]): number[] {
  const n = Array(10).fill(0);
  for (const v of g) if (v) n[v]++;
  return n;
}

// ---------------------------------------------------------------------------
// Notes: one bitmask per square (bit d = note d).
// ---------------------------------------------------------------------------

export type Notes = number[];

export const emptyNotes = (): Notes => Array(CELLS).fill(0);

export const hasNote = (notes: Notes, c: number, d: number) => (notes[c] & (1 << d)) !== 0;

export function toggleNote(notes: Notes, c: number, d: number): Notes {
  const next = notes.slice();
  next[c] ^= 1 << d;
  return next;
}

/** After `d` goes in square `c`: its notes go, and `d` leaves its peers' notes. */
export function placeClearsNotes(notes: Notes, c: number, d: number): Notes {
  const next = notes.slice();
  next[c] = 0;
  for (const p of PEERS[c]) next[p] &= ~(1 << d);
  return next;
}

export const noteDigits = (mask: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => (mask & (1 << d)) !== 0);

/** Notes saved as text (this browser only): bad data gives empty notes. */
export function readNotes(raw: string | null): Notes {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (Array.isArray(v) && v.length === CELLS && v.every((x) => Number.isInteger(x) && x >= 0 && x < 1024)) return v as Notes;
  } catch {
    /* bad JSON */
  }
  return emptyNotes();
}

// ---------------------------------------------------------------------------
// Cursor and time
// ---------------------------------------------------------------------------

/** Move the cursor; it wraps around the edges. */
export function moveCursor(c: number, dir: "up" | "down" | "left" | "right"): number {
  const r = row(c);
  const k = col(c);
  if (dir === "up") return ((r + 8) % 9) * 9 + k;
  if (dir === "down") return ((r + 1) % 9) * 9 + k;
  if (dir === "left") return r * 9 + ((k + 8) % 9);
  return r * 9 + ((k + 1) % 9);
}

/** 754_000 → "12:34"; an hour or more → "1:02:03". */
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "row 4, column 7". */
export const squareName = (c: number) => `row ${row(c) + 1}, column ${col(c) + 1}`;
