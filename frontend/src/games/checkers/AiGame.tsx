import { useEffect, useRef, useState } from "react";
import { checkers } from "../../api/client";
import type { CheckersGame } from "../../api/types";
import { VersusBar, ZERO_BOT } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { pingResult } from "../../mascot/bus";
import { useWallet } from "../../store/wallet";
import Board from "./Board";
import { ENDING_TEXT, LEVEL_LABEL, SIDE_LABEL, SidePanel } from "./common";
import { itemName } from "./items";
import { Game, parsePath } from "./rules";

/** Your move drawn right away while the server checks it and Zero-Bot replies. */
function optimistic(cells: number[], turn: "dark" | "light", mv: string): number[] | null {
  const g = new Game(cells, turn);
  const path = parsePath(mv);
  return path && g.playPath(path) ? g.cells : null;
}

const lastOf = (moves: string[]) => moves[moves.length - 1] ?? null;

export default function AiGame({
  initial,
  onExit,
  onRematch,
}: {
  initial: CheckersGame;
  onExit: () => void;
  onRematch: (g: CheckersGame) => void;
}) {
  const [game, setGame] = useState(initial);
  const [shown, setShown] = useState({ cells: initial.cells, last: initial.ai_move ?? lastOf(initial.moves) });
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

  const active = game.status === "active";

  function show(g: CheckersGame) {
    setGame(g);
    setShown({ cells: g.cells, last: lastOf(g.moves) });
  }

  function announce(g: CheckersGame) {
    if (g.status === "active") {
      if (g.ai_move) playSfx(g.ai_move.includes("x") ? "clank" : "land");
      return;
    }
    playSfx(g.status === "won" ? "win" : g.status === "drawn" ? "draw" : "lose");
    pingResult(g.status === "won" ? "cheer" : g.status === "drawn" ? "draw" : "sad");
    useWallet.getState().celebrate(g.rewards);
  }

  async function move(mv: string) {
    if (!active || busy) return;
    const cells = optimistic(game.cells, game.turn, mv);
    if (cells) setShown({ cells, last: mv });
    playSfx(mv.includes("x") ? "clank" : "drop");
    setBusy(true);
    setError(null);
    try {
      const [g] = await Promise.all([checkers.move(game.id, mv), new Promise((r) => window.setTimeout(r, 350))]);
      if (!mounted.current) return;
      show(g);
      announce(g);
    } catch (e) {
      setShown({ cells: game.cells, last: lastOf(game.moves) });
      setError(e instanceof Error ? e.message : "move failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function run(action: () => Promise<CheckersGame>) {
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

  const result = game.status === "won" ? "win" : game.status === "drawn" ? "draw" : active ? null : "loss";
  let status: string;
  if (game.status === "won") status = `🏆 You beat Zero-Bot on ${LEVEL_LABEL[game.level]}!`;
  else if (game.status === "lost") status = "💀 No moves left. Zero-Bot wins this one.";
  else if (game.status === "resigned") status = "🏳 You resigned.";
  else if (game.status === "drawn") status = `🤝 ${ENDING_TEXT[game.ending ?? ""] ?? "Draw."}`;
  else if (busy) status = "Zero-Bot is thinking…";
  else status = game.legal.some((m) => m.includes("x")) ? "Your move: you must jump!" : "Your move";

  return (
    <div className="c4-play ck-play">
      <VersusBar
        opponent={ZERO_BOT}
        opponentName={`Zero-Bot · ${LEVEL_LABEL[game.level]}`}
        turn={!active ? null : busy ? "them" : "me"}
        result={result}
      />
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="ck-layout">
        <Board
          cells={shown.cells}
          bottom={game.side}
          legal={busy ? [] : game.legal}
          lastMove={shown.last}
          boardStyle={game.board_style}
          pieceSet={game.piece_set}
          onMove={(m) => void move(m)}
        />
        <SidePanel
          you={`You play ${SIDE_LABEL[game.side]}`}
          cells={shown.cells}
          moves={game.moves}
          quietLeft={active ? game.quiet_left : undefined}
        />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!active && (
        <div className="result-card">
          <h3>{status}</h3>
          {game.drop && (
            <p className="unlock">
              🍀 Lucky drop: you won the {itemName(game.drop)} {game.drop.startsWith("board") ? "board" : "piece set"}!
            </p>
          )}
          {game.status === "won" && game.undos_left < 3 && <p className="hint">Undo was used, so no bonus points or token this time.</p>}
        </div>
      )}
      <div className="game-controls">
        {active && (
          <>
            <button
              className="btn-blue"
              disabled={busy || game.undos_left === 0 || game.moves.length < 1 || (game.side === "light" && game.moves.length < 2)}
              onClick={() => void run(() => checkers.undo(game.id))}
              title="Takes back your last move. Using undo costs the win bonus and token."
            >
              ↶ Undo ({game.undos_left})
            </button>
            {confirmResign ? (
              <span className="g2048-confirm">
                Resign this game?
                <button className="btn-danger btn-sm" onClick={() => void run(() => checkers.resign(game.id)).then((g) => g && announce(g))}>
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
              const g = await run(() => checkers.create(game.level, game.side, game.board_style, game.piece_set));
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
      {active && <p className="hint">Click a piece, then where it goes (for a double jump, click each landing square). Undo: up to 3 per game.</p>}
    </div>
  );
}
