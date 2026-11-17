/**
 * Picking a move by clicking squares. A move can be a long capture chain, so
 * you click the piece, then each landing square in turn; the move is sent
 * once the path matches a whole legal move. Pure logic (no React) so it can
 * be unit-tested.
 */
import { parsePath } from "./rules";

export interface LegalPath {
  /** The move in notation ("22x15x8"). */
  notation: string;
  /** Squares visited, 0-based. */
  path: number[];
}

export const toPaths = (legal: string[]): LegalPath[] =>
  legal.flatMap((n) => {
    const p = parsePath(n);
    return p ? [{ notation: n, path: p }] : [];
  });

const startsWith = (path: number[], prefix: number[]) => prefix.every((s, i) => path[i] === s);

/** Squares you can start a move from. */
export function movable(legal: LegalPath[]): Set<number> {
  return new Set(legal.map((l) => l.path[0]));
}

/** Where the piece can go next after the squares picked so far. */
export function nextSteps(legal: LegalPath[], picked: number[]): Set<number> {
  const out = new Set<number>();
  for (const l of legal) if (l.path.length > picked.length && startsWith(l.path, picked)) out.add(l.path[picked.length]);
  return out;
}

export type PickResult =
  | { kind: "picking"; picked: number[] }
  | { kind: "done"; notation: string }
  | { kind: "none" };

/**
 * Click a square. Clicking a movable piece (re)starts the pick; clicking a
 * next step extends it and finishes when it makes a whole legal move;
 * anything else clears it.
 */
export function click(legal: LegalPath[], picked: number[], sq: number): PickResult {
  if (picked.length > 0 && nextSteps(legal, picked).has(sq)) {
    const next = [...picked, sq];
    const whole = legal.find((l) => l.path.length === next.length && startsWith(l.path, next));
    // A whole move that can't be extended any further is sent right away.
    if (whole && nextSteps(legal, next).size === 0) return { kind: "done", notation: whole.notation };
    return { kind: "picking", picked: next };
  }
  if (movable(legal).has(sq)) return { kind: "picking", picked: [sq] };
  return { kind: "none" };
}
