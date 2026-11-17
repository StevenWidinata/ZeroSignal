import type { CheckersLevel, CheckersSide } from "../../api/types";
import { findBoard } from "./items";
import Piece from "./Piece";

export const LEVEL_LABEL: Record<CheckersLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard", master: "Master" };
export const SIDE_LABEL: Record<CheckersSide, string> = { dark: "Dark ⚫", light: "Light ⚪" };

/** How a game ended, for the player. */
export const ENDING_TEXT: Record<string, string> = {
  no_moves: "No moves left.",
  repetition: "Draw: the same position came up three times.",
  quiet: "Draw: 40 moves each without a capture or a man moving.",
  resign: "Resigned.",
};

/** Pieces left per side: [dark men, dark kings, light men, light kings]. */
export function countPieces(cells: number[]): [number, number, number, number] {
  const n: [number, number, number, number] = [0, 0, 0, 0];
  for (const c of cells) {
    if (c === 1) n[0]++;
    else if (c === 2) n[1]++;
    else if (c === -1) n[2]++;
    else if (c === -2) n[3]++;
  }
  return n;
}

/** Side panel: who you are, pieces left, the move list. */
export function SidePanel({
  you,
  cells,
  moves,
  quietLeft,
  extra,
  first = "dark",
}: {
  /** Who made the first move (puzzles can start with Light). */
  first?: CheckersSide;
  you: string;
  cells: number[];
  moves: string[];
  quietLeft?: number;
  extra?: React.ReactNode;
}) {
  const [dm, dk, lm, lk] = countPieces(cells);
  return (
    <aside className="ck-side panel">
      <p>{you}</p>
      <dl className="ck-count">
        <div>
          <dt>⚫ Dark</dt>
          <dd>
            {dm + dk} pieces{dk > 0 && ` (${dk} ♛)`}
          </dd>
        </div>
        <div>
          <dt>⚪ Light</dt>
          <dd>
            {lm + lk} pieces{lk > 0 && ` (${lk} ♛)`}
          </dd>
        </div>
      </dl>
      {quietLeft !== undefined && quietLeft <= 20 && (
        <p className="hint">⏳ Draw in {quietLeft} more turns unless someone captures or moves a man.</p>
      )}
      {extra}
      <h3>Moves</h3>
      <p className="ck-moves" aria-label="Moves so far">
        {moves.length === 0
          ? `No moves yet. ${first === "dark" ? "Dark" : "Light"} starts.`
          : moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : ` ${m} `)).join("")}
      </p>
    </aside>
  );
}

/** A 2×2 corner of a board style. */
export function BoardSwatch({ id, size = 44 }: { id: string; size?: number }) {
  const a = findBoard(id).art;
  return (
    <span className={`ck-swatch board-${a.style}`} style={{ width: size, height: size, borderColor: a.border }} aria-hidden="true">
      {[a.light, a.dark, a.dark, a.light].map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** A dark king and a light man from a piece set. */
export function PiecesSwatch({ id, size = 44 }: { id: string; size?: number }) {
  return (
    <span className="ck-pieces-swatch" style={{ width: size, height: size }} aria-hidden="true">
      <Piece value={2} set={id} size={size * 0.5} />
      <Piece value={-1} set={id} size={size * 0.46} />
    </span>
  );
}
