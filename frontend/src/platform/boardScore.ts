/**
 * What a leaderboard row shows for a score on a board. Most boards show the
 * score and its `detail` as numbers; a packed board (Brick Breaker's
 * Campaign: stars × 10,000,000 + total score) shows the two parts apart.
 */
import type { GameBoard } from "./types";

const fmt = (n: number) => n.toLocaleString();

/**
 * `run`: a row in "Your runs", where the columns are the game's usual ones,
 * so a packed score shows its second part as the score and the first one
 * (e.g. "12 stars") in the detail column.
 */
export function boardCells(board: GameBoard | undefined, score: number, detail: string | null | undefined, run = false): { main: string; extra: string } {
  if (board?.packed) {
    const main = Math.floor(score / board.packed);
    const rest = score % board.packed;
    if (run) return { main: fmt(rest), extra: `${fmt(main)} ${(board.scoreLabel ?? "").toLowerCase()}`.trim() };
    return { main: fmt(main), extra: fmt(rest) };
  }
  const n = detail == null || detail === "" ? NaN : Number(detail);
  return { main: fmt(score), extra: Number.isFinite(n) ? fmt(n) : detail ? detail : "–" };
}
