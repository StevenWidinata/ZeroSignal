import { Chess } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { chess } from "../../api/client";
import type { ChessGame, ChessLevel } from "../../api/types";
import { VersusBar, ZERO_BOT } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { pingResult } from "../../mascot/bus";
import { useWallet } from "../../store/wallet";
import ChessBoard from "./ChessBoard";
import { ENDING_TEXT } from "./endings";
import { lastOf, sideOf } from "./fen";
import { itemName } from "./items";
import MoveList from "./MoveList";

export const LEVEL_LABEL: Record<ChessLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard", master: "Master" };

/** Your move drawn right away while the server checks it and Zero-Bot replies. */
function optimistic(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  } catch {
    return null;
  }
}

export default function AiGame({ initial, onExit, onRematch }: { initial: ChessGame; onExit: () => void; onRematch: (g: ChessGame) => void }) {
  const [game, setGame] = useState(initial);
  const [shown, setShown] = useState<{ fen: string; last: string | null }>({ fen: initial.fen, last: initial.ai_move ?? lastOf(initial.moves) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const me = sideOf(game.color);
  const active = game.status === "active";

  function show(g: ChessGame) {
    setGame(g);
    setShown({ fen: g.fen, last: lastOf(g.moves) });
  }

  function announce(g: ChessGame) {
    if (g.status === "active") {
      if (g.ai_move) playSfx(g.in_check ? "zap" : "land");
      return;
    }
    playSfx(g.status === "won" ? "win" : g.status === "drawn" ? "draw" : "lose");
    pingResult(g.status === "won" ? "cheer" : g.status === "drawn" ? "draw" : "sad");
    useWallet.getState().celebrate(g.rewards);
  }

  async function move(uci: string) {
    if (!active || busy) return;
    const fen = optimistic(game.fen, uci);
    if (fen) setShown({ fen, last: uci });
    playSfx("drop");
    setBusy(true);
    setError(null);
    try {
      const [g] = await Promise.all([chess.move(game.id, uci), new Promise((r) => window.setTimeout(r, 250))]);
      if (!mounted.current) return;
      show(g);
      announce(g);
    } catch (e) {
      setShown({ fen: game.fen, last: lastOf(game.moves) });
      setError(e instanceof Error ? e.message : "move failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function run(action: () => Promise<ChessGame>) {
    setBusy(true);
    setError(null);
    try {
      const g = await action();
      if (!mounted.current) return null;
      show(g);
      return g;
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const result = game.status === "won" ? "win" : game.status === "drawn" ? "draw" : game.status === "active" ? null : "loss";
  let status: string;
  if (game.status === "won") status = `🏆 Checkmate! You beat Zero-Bot on ${LEVEL_LABEL[game.level]}!`;
  else if (game.status === "lost") status = "💀 Checkmate. Zero-Bot wins this one.";
  else if (game.status === "resigned") status = "🏳 You resigned.";
  else if (game.status === "drawn") status = `🤝 ${ENDING_TEXT[game.ending ?? ""] ?? "Draw."}`;
  else if (busy) status = "Zero-Bot is thinking…";
  else status = game.in_check ? "Check! Your move." : "Your move";

  return (
    <div className="c4-play chess-play">
      <VersusBar opponent={ZERO_BOT} opponentName={`Zero-Bot · ${LEVEL_LABEL[game.level]}`} turn={!active ? null : busy ? "them" : "me"} result={result} />
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="chess-layout">
        <ChessBoard
          fen={shown.fen}
          orientation={me}
          legal={busy ? [] : game.legal}
          lastMove={shown.last}
          check={!busy && game.in_check}
          boardStyle={game.board_style}
          pieceSet={game.piece_set}
          onMove={(u) => void move(u)}
        />
        <aside className="chess-side panel">
          <p className="chess-you">
            You play <strong>{me === "w" ? "White ♔" : "Black ♚"}</strong>
          </p>
          <MoveList san={game.san} />
        </aside>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!active && (
        <div className="result-card">
          <h3>{status}</h3>
          {game.drop && <p className="unlock">🍀 Lucky drop: you won the {itemName(game.drop)} {game.drop.startsWith("board") ? "board" : "piece set"}!</p>}
          {game.status === "won" && game.undos_left < 3 && <p className="hint">Undo was used, so no bonus points or token this time.</p>}
        </div>
      )}
      <div className="game-controls">
        {active && (
          <>
            <button
              className="btn-blue"
              disabled={busy || game.undos_left === 0 || game.moves.length < 2}
              onClick={() => void run(() => chess.undo(game.id))}
              title="Takes back your last move. Using undo costs the win bonus and token."
            >
              ↶ Undo ({game.undos_left})
            </button>
            {confirmResign ? (
              <span className="g2048-confirm">
                Resign this game?
                <button className="btn-danger btn-sm" onClick={() => void run(() => chess.resign(game.id)).then((g) => g && announce(g))}>
                  Yes, resign
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmResign(false)}>
                  Keep playing
                </button>
              </span>
            ) : (
              <button className="btn-ghost" disabled={busy} onClick={() => setConfirmResign(true)}>
                🏳 Resign
              </button>
            )}
          </>
        )}
        {!active && (
          <button
            className="btn-green"
            disabled={busy}
            onClick={async () => {
              const g = await run(() => chess.create(game.level, game.color, game.board_style, game.piece_set));
              if (g) onRematch(g);
            }}
          >
            ↻ Play again
          </button>
        )}
        <button className="btn-ghost" onClick={onExit} disabled={busy && active}>
          ← Menu
        </button>
      </div>
      {!active && <SaveScorePrompt />}
      {active && <p className="hint">Every move is checked by the server. Undo: up to 3 per game (it cancels the win bonus).</p>}
    </div>
  );
}
