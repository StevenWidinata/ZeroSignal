/**
 * Aiming a Tactics power: pick a power, tap a square to see what it would
 * touch, then tap that square again (or press Fire) to use it. Turn (R)
 * swaps a line between row and column, or picks the torpedo's edge. A salvo
 * collects its squares one tap at a time. Plain functions, so they're tested
 * without a browser.
 */
import { flareArea, lineCells, torpedoPath, type Edge, SIZE } from "./rules";
import { AIR_STRIKE, FLARE, RADAR, SALVO, TORPEDO } from "./tactics";

export interface Aim {
  power: number;
  /** The square picked (not for a salvo). */
  cell: number | null;
  /** Air strike and radar: along a row (true) or a column. */
  horizontal: boolean;
  /** Torpedo: the edge it starts from. */
  edge: Edge;
  /** Salvo: the squares picked so far. */
  picks: number[];
}

export const startAim = (power: number): Aim => ({ power, cell: null, horizontal: true, edge: "l", picks: [] });

/** Squares you can still fire at (unknown, spotted ship, crate seen). */
export const isOpen = (marks: string, cell: number) => marks[cell] === "." || marks[cell] === "*" || marks[cell] === "+";

/** Torpedo edges at this size (Mk III can start from any edge). */
export const edgesFor = (size: number): Edge[] => (size >= 4 ? ["l", "u", "r", "d"] : ["l", "u"]);

/** An air strike of `size` squares centred on `cell` (moved in to fit): its first square. */
export function strikeBow(cell: number, horizontal: boolean, size: number): number {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const start = (x: number) => Math.min(Math.max(x - Math.floor((size - 1) / 2), 0), SIZE - size);
  return horizontal ? r * SIZE + start(c) : start(r) * SIZE + c;
}

/** The line a torpedo aimed at `cell` runs along. */
const torpedoLine = (cell: number, edge: Edge) => (edge === "l" || edge === "r" ? Math.floor(cell / SIZE) : cell % SIZE);

/** What the aimed power would touch, and whether it can be used like this. */
export function aimPreview(a: Aim, size: number, marks: string): { cells: number[]; ok: boolean } | null {
  if (a.power === SALVO) return a.picks.length ? { cells: a.picks, ok: a.picks.length === size } : null;
  if (a.cell === null) return null;
  const cell = a.cell;
  switch (a.power) {
    case AIR_STRIKE: {
      const bow = strikeBow(cell, a.horizontal, size);
      const cells = Array.from({ length: size }, (_, k) => (a.horizontal ? bow + k : bow + k * SIZE));
      return { cells, ok: cells.some((c) => isOpen(marks, c)) };
    }
    case RADAR:
      return { cells: lineCells(a.horizontal ? Math.floor(cell / SIZE) : cell % SIZE, a.horizontal), ok: true };
    case TORPEDO:
      return { cells: torpedoPath(torpedoLine(cell, a.edge), a.edge), ok: true };
    case FLARE: {
      const cells = flareArea(cell, size);
      return { cells, ok: cells.some((c) => marks[c] === ".") };
    }
  }
  return null;
}

/** The move code for the aimed power, or null if it isn't ready to fire. */
export function aimCode(a: Aim, size: number, marks: string): string | null {
  const p = aimPreview(a, size, marks);
  if (!p?.ok) return null;
  if (a.power === SALVO) return `b${a.picks.join(".")}`;
  const cell = a.cell!;
  switch (a.power) {
    case AIR_STRIKE:
      return `a${strikeBow(cell, a.horizontal, size)}${a.horizontal ? "h" : "v"}`;
    case RADAR:
      return a.horizontal ? `r${Math.floor(cell / SIZE)}` : `k${cell % SIZE}`;
    case TORPEDO:
      return `t${torpedoLine(cell, a.edge)}${a.edge}`;
    case FLARE:
      return `l${cell}`;
  }
  return null;
}

/** Turn: row <-> column, or the torpedo's next edge. */
export function turnAim(a: Aim, size: number): Aim {
  if (a.power === TORPEDO) {
    const edges = edgesFor(size);
    return { ...a, edge: edges[(edges.indexOf(a.edge) + 1) % edges.length] };
  }
  return { ...a, horizontal: !a.horizontal };
}

/** Whether a power uses Turn at all. */
export const canTurn = (power: number) => power === AIR_STRIKE || power === RADAR || power === TORPEDO;

/**
 * A tap on `cell` while aiming: picks it (or, for a salvo, adds or removes
 * it). Tapping the picked square again fires when it can.
 */
export function tapAim(a: Aim, cell: number, size: number, marks: string): { aim: Aim; fire: boolean } {
  if (a.power === SALVO) {
    if (a.picks.includes(cell)) return { aim: { ...a, picks: a.picks.filter((c) => c !== cell) }, fire: false };
    if (!isOpen(marks, cell) || a.picks.length >= size) return { aim: a, fire: false };
    return { aim: { ...a, picks: [...a.picks, cell] }, fire: false };
  }
  if (a.cell === cell) return { aim: a, fire: aimCode(a, size, marks) !== null };
  return { aim: { ...a, cell }, fire: false };
}

/** A short hint for the aiming panel. */
export function aimHint(a: Aim, size: number): string {
  switch (a.power) {
    case AIR_STRIKE:
      return `Tap a square: ${size} squares in a ${a.horizontal ? "row" : "column"} around it get hit.`;
    case SALVO:
      return `Pick ${size} squares to fire at (${a.picks.length}/${size}).`;
    case RADAR:
      return `Tap a square: the radar counts ship squares in its whole ${a.horizontal ? "row" : "column"}.`;
    case TORPEDO:
      return `Tap a square: the torpedo runs in from the ${{ l: "left", r: "right", u: "top", d: "bottom" }[a.edge]} edge and hits the first ship it meets.`;
    default:
      return size >= 9 ? "Tap a square: the flare lights up the 3×3 around it." : "Tap a square: the flare lights it and the 4 squares next to it.";
  }
}
