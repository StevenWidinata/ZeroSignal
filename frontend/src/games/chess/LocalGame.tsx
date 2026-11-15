import { Chess } from "chess.js";
import { useMemo, useState } from "react";
import { playSfx } from "../../platform/sound";
import ChessBoard from "./ChessBoard";
import { lastOf } from "./fen";
import { ENDING_TEXT } from "./endings";
import MoveList from "./MoveList";

type Ending = { kind: "checkmate"; winner: "w" | "b" } | { kind: "draw"; reason: string } | { kind: "resign"; winner: "w" | "b" };

/** What chess.js says about the position. */
function endingOf(c: Chess): Ending | null {
  if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "b" : "w" };
  if (c.isStalemate()) return { kind: "draw", reason: "stalemate" };
  if (c.isThreefoldRepetition()) return { kind: "draw", reason: "repetition" };
  if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient_material" };
  if (c.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty_moves" };
  return null;
}

/** Two players, one device: pass and play. Nothing is sent to the server. */
export default function LocalGame({ names, look, onExit }: { names: [string, string]; look: { board: string; pieces: string }; onExit: () => void }) {
  const [moves, setMoves] = useState<string[]>([]);
  const [manual, setManual] = useState<Ending | null>(null);
  const [autoFlip, setAutoFlip] = useState(true);
  const [confirm, setConfirm] = useState<"resign" | "draw" | null>(null);

  const c = useMemo(() => {
    const g = new Chess();
    for (const u of moves) g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return g;
  }, [moves]);
  const ending = manual ?? endingOf(c);
  const turn = c.turn();
  const legal = ending ? [] : c.moves({ verbose: true }).map((m) => m.lan);
  const name = (s: "w" | "b") => (s === "w" ? names[0] : names[1]);

  function play(u: string) {
    const next = [...moves, u];
    setMoves(next);
    const g = new Chess();
    for (const m of next) g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    const end = endingOf(g);
    playSfx(end ? (end.kind === "draw" ? "draw" : "win") : g.inCheck() ? "zap" : "drop");
  }

  let status: string;
  if (ending?.kind === "checkmate") status = `🏆 Checkmate! ${name(ending.winner)} wins.`;
  else if (ending?.kind === "resign") status = `🏳 ${name(ending.winner === "w" ? "b" : "w")} resigned. ${name(ending.winner)} wins.`;
  else if (ending?.kind === "draw") status = `🤝 ${ENDING_TEXT[ending.reason] ?? "Draw."}`;
  else status = `${name(turn)} to move (${turn === "w" ? "White" : "Black"})${c.inCheck() ? " · Check!" : ""}`;

  return (
    <div className="c4-play chess-play">
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="chess-layout">
        <ChessBoard
          fen={c.fen()}
          orientation={autoFlip && !ending ? turn : "w"}
          legal={legal}
          lastMove={lastOf(moves)}
          check={c.inCheck()}
          boardStyle={look.board}
          pieceSet={look.pieces}
          onMove={play}
        />
        <aside className="chess-side panel">
          <p className="chess-you">
            ♔ <strong>{names[0]}</strong> vs ♚ <strong>{names[1]}</strong>
          </p>
          <label className="row-label">
            <span>Turn the board for each player</span>
            <input type="checkbox" className="switch" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} />
          </label>
          <MoveList san={c.history()} />
        </aside>
      </div>
      <div className="game-controls">
        {!ending && (
          <>
            <button className="btn-blue" disabled={!moves.length} onClick={() => setMoves(moves.slice(0, -1))}>
              ↶ Undo
            </button>
            {confirm ? (
              <span className="g2048-confirm">
                {confirm === "resign" ? `${name(turn)} resigns?` : "Both players agree to a draw?"}
                <button
                  className="btn-danger btn-sm"
                  onClick={() => {
                    setManual(confirm === "resign" ? { kind: "resign", winner: turn === "w" ? "b" : "w" } : { kind: "draw", reason: "agreement" });
                    setConfirm(null);
                    playSfx("draw");
                  }}
                >
                  Yes
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirm(null)}>
                  No
                </button>
              </span>
            ) : (
              <>
                <button className="btn" onClick={() => setConfirm("draw")}>
                  ½ Draw
                </button>
                <button className="btn-ghost" onClick={() => setConfirm("resign")}>
                  🏳 Resign
                </button>
              </>
            )}
          </>
        )}
        {ending && (
          <button
            className="btn-green"
            onClick={() => {
              setMoves([]);
              setManual(null);
            }}
          >
            ↻ New game
          </button>
        )}
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      <p className="hint">Same-device games are just for fun: no coins or leaderboard points.</p>
    </div>
  );
}
