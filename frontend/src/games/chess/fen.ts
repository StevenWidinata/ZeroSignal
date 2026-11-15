/** Small helpers to draw a position from FEN and read UCI move lists. */

export type Color = "w" | "b";
export type PieceType = "k" | "q" | "r" | "b" | "n" | "p";
export interface Piece {
  type: PieceType;
  color: Color;
}

export const FILES = "abcdefgh";
export const PIECE_NAME: Record<PieceType, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };

/** 64 squares, index 0 = a8, 7 = h8, … 63 = h1 (FEN order). */
export function parseFen(fen: string): (Piece | null)[] {
  const out: (Piece | null)[] = [];
  for (const ch of fen.split(" ")[0] ?? "") {
    if (ch === "/") continue;
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
    else out.push({ type: ch.toLowerCase() as PieceType, color: ch === ch.toUpperCase() ? "w" : "b" });
  }
  while (out.length < 64) out.push(null);
  return out.slice(0, 64);
}

export function squareName(i: number): string {
  return `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
}

export function squareIndex(sq: string): number {
  return (8 - Number(sq[1])) * 8 + FILES.indexOf(sq[0]);
}

export function isLight(i: number): boolean {
  return (Math.floor(i / 8) + (i % 8)) % 2 === 0;
}

export function sideToMove(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** Where the given side's king stands, or -1. */
export function kingIndex(board: (Piece | null)[], color: Color): number {
  return board.findIndex((p) => p?.type === "k" && p.color === color);
}

/** Legal UCI moves grouped by their start square. */
export function movesFrom(legal: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const u of legal) {
    const from = u.slice(0, 2);
    m.set(from, [...(m.get(from) ?? []), u]);
  }
  return m;
}

/** The moves (1 normally, 4 for a promotion) that go from → to. */
export function movesBetween(legal: string[], from: string, to: string): string[] {
  return legal.filter((u) => u.slice(0, 4) === from + to);
}

/** "white"/"black" from the server → "w"/"b". */
export const sideOf = (c: "white" | "black"): Color => (c === "black" ? "b" : "w");

/** The last item, or null. */
export const lastOf = <T,>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);
