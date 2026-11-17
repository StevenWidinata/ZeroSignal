import { useMemo, useState } from "react";
import { playSfx } from "../../platform/sound";
import Board from "./Board";
import { ENDING_TEXT, SidePanel } from "./common";
import { Game, QUIET_LIMIT, notation, parsePath, type Side } from "./rules";

/** Two players, one device: pass and play. Nothing is sent to the server. */
export default function LocalGame({ names, look, onExit }: { names: [string, string]; look: { board: string; pieces: string }; onExit: () => void }) {
  const [moves, setMoves] = useState<string[]>([]);
  const [resigned, setResigned] = useState<Side | null>(null);
  const [autoFlip, setAutoFlip] = useState(true);
  const [confirm, setConfirm] = useState(false);

  const g = useMemo(() => Game.replay(moves.join(" ")) ?? new Game(), [moves]);
  const outcome = g.outcome();
  const over = resigned !== null || outcome.kind !== "ongoing";
  const legal = over ? [] : g.legalMoves().map(notation);
  const name = (s: Side) => (s === "dark" ? names[0] : names[1]);

  function play(mv: string) {
    const next = [...moves, mv];
    const after = Game.replay(next.join(" "));
    if (!after) return;
    setMoves(next);
    const o = after.outcome();
    playSfx(o.kind === "win" ? "win" : o.kind === "draw" ? "draw" : mv.includes("x") ? "clank" : "drop");
  }

  let status: string;
  if (resigned) status = `🏳 ${name(resigned)} resigned. ${name(resigned === "dark" ? "light" : "dark")} wins!`;
  else if (outcome.kind === "win") status = `🏆 ${name(outcome.side)} wins! ${ENDING_TEXT.no_moves}`;
  else if (outcome.kind === "draw") status = `🤝 ${g.quiet >= QUIET_LIMIT ? ENDING_TEXT.quiet : ENDING_TEXT.repetition}`;
  else status = `${name(g.turn)} to move (${g.turn === "dark" ? "Dark ⚫" : "Light ⚪"})${legal.some((m) => m.includes("x")) ? " · must jump!" : ""}`;

  const bottom: Side = autoFlip ? g.turn : "dark";
  const last = moves[moves.length - 1] ?? null;

  return (
    <div className="c4-play ck-play">
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="ck-layout">
        <Board
          cells={g.cells}
          bottom={bottom}
          legal={legal}
          lastMove={last && parsePath(last) ? last : null}
          boardStyle={look.board}
          pieceSet={look.pieces}
          onMove={play}
        />
        <SidePanel
          you={`${names[0]}: Dark ⚫ · ${names[1]}: Light ⚪`}
          cells={g.cells}
          moves={moves}
          quietLeft={over ? undefined : QUIET_LIMIT - g.quiet}
          extra={
            <label className="row-label">
              <span>Turn the board for each player</span>
              <input type="checkbox" className="switch" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} />
            </label>
          }
        />
      </div>
      <div className="game-controls">
        {!over && moves.length > 0 && (
          <button className="btn-blue" onClick={() => setMoves(moves.slice(0, -1))}>
            ↶ Undo
          </button>
        )}
        {!over &&
          (confirm ? (
            <span className="g2048-confirm">
              {name(g.turn)} resigns?
              <button
                className="btn-danger btn-sm"
                onClick={() => {
                  setResigned(g.turn);
                  setConfirm(false);
                  playSfx("lose");
                }}
              >
                Yes
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirm(true)}>
              🏳 Resign
            </button>
          ))}
        {over && (
          <button
            className="btn-green"
            onClick={() => {
              setMoves([]);
              setResigned(null);
            }}
          >
            ↻ New game
          </button>
        )}
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      <p className="hint">Just for fun on one device: no coins or points.</p>
    </div>
  );
}
