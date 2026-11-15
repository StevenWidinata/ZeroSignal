import { findBoard } from "./items";
import PieceIcon from "./PieceIcon";

/** A 2×2 corner of a board style. */
export function BoardSwatch({ id, size = 44 }: { id: string; size?: number }) {
  const a = findBoard(id).art;
  return (
    <span className={`chess-swatch board-${a.style}`} style={{ width: size, height: size, borderColor: a.border }} aria-hidden="true">
      {[a.light, a.dark, a.dark, a.light].map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** A white knight and a black pawn from a piece set. */
export function PiecesSwatch({ id, size = 44 }: { id: string; size?: number }) {
  return (
    <span className="chess-pieces-swatch" style={{ width: size, height: size }} aria-hidden="true">
      <PieceIcon type="n" color="w" set={id} size={size * 0.62} />
      <PieceIcon type="p" color="b" set={id} size={size * 0.5} />
    </span>
  );
}
