import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { chess } from "../../api/client";
import type { ChessPuzzle } from "../../api/types";
import { MyReaction } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import ChessBoard from "./ChessBoard";
import { lastOf, sideOf } from "./fen";
import MoveList from "./MoveList";

function after(fen: string, moves: string[]): string {
  const c = new Chess(fen);
  for (const u of moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c.fen();
}

function sanOf(fen: string, moves: string[]): string[] {
  const c = new Chess(fen);
  for (const u of moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c.history();
}

/** The Daily puzzle: the same "mate in 2" for everyone each WIB day. */
export default function PuzzleGame({ look, onExit }: { look: { board: string; pieces: string }; onExit: () => void }) {
  const [p, setP] = useState<ChessPuzzle | null>(null);
  const [shown, setShown] = useState<{ fen: string; last: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    chess
      .puzzle()
      .then((x) => {
        setP(x);
        setShown({ fen: x.fen, last: lastOf(x.moves) });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "could not load today's puzzle"));
    return () => {
      mounted.current = false;
    };
  }, []);

  const solutionFens = useMemo(
    () => (p?.solution ? p.solution.map((_, i) => after(p.start_fen, p.solution!.slice(0, i + 1))) : []),
    [p?.solution, p?.start_fen],
  );

  if (!p || !shown) return error ? <div className="error">{error}</div> : <div className="loading">Loading today's puzzle</div>;

  const me = sideOf(p.color);
  const open = p.status === "new" || p.status === "playing";

  async function move(uci: string) {
    if (!p || busy || !open) return;
    const fen = after(shown!.fen, [uci]);
    setShown({ fen, last: uci });
    playSfx("drop");
    setBusy(true);
    setError(null);
    try {
      const next = await chess.puzzleMove(uci);
      if (!mounted.current) return;
      if (next.correct === false) {
        // Not it: put the piece back and show which square was wrong.
        playSfx("whiff");
        setFlash(uci.slice(2, 4));
        window.setTimeout(() => mounted.current && setFlash(null), 700);
        setShown({ fen: next.fen, last: lastOf(next.moves) });
      } else if (next.reply) {
        playSfx("chime");
        await new Promise((r) => window.setTimeout(r, 450));
        if (!mounted.current) return;
        playSfx("land");
        setShown({ fen: next.fen, last: next.reply });
      } else {
        setShown({ fen: next.fen, last: lastOf(next.moves) });
      }
      if (next.status === "solved") {
        playSfx("win");
        useWallet.getState().celebrate(next.rewards);
      } else if (next.status === "failed") {
        playSfx("lose");
      }
      setP(next);
    } catch (e) {
      setShown({ fen: p.fen, last: lastOf(p.moves) });
      setError(e instanceof Error ? e.message : "move failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const viewing = step !== null && p.solution;
  const boardFen = viewing ? (step === 0 ? p.start_fen : solutionFens[step - 1]) : shown.fen;
  const boardLast = viewing ? (step === 0 ? null : p.solution![step - 1]) : shown.last;
  const hearts = "❤️".repeat(p.mistakes_left) + "🤍".repeat(Math.max(0, 3 - p.mistakes_left));

  let status: string;
  if (p.status === "solved") status = `🧩 Solved! ${p.points ? `+${p.points} pts. ` : ""}Come back tomorrow for a new one.`;
  else if (p.status === "failed") status = "Out of tries. Step through the solution below, and try again tomorrow!";
  else if (busy) status = "Checking…";
  else if (p.moves.length) status = `Good move! Zero-Bot replied. Now finish it: mate in ${p.mate_in - p.moves.length / 2}.`;
  else status = `${me === "w" ? "White" : "Black"} to move and mate in ${p.mate_in}.`;

  return (
    <div className="c4-play chess-play">
      <div className="chess-puzzle-head">
        <strong>📅 Puzzle #{p.number}</strong>
        <span title="Tries left" aria-label={`${p.mistakes_left} tries left`}>
          {hearts}
        </span>
        <span title="Days in a row solved">🔥 {p.streak} day streak</span>
      </div>
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="chess-layout">
        <ChessBoard
          fen={boardFen}
          orientation={me}
          legal={open && !busy && !viewing ? p.legal : []}
          lastMove={boardLast}
          check={!viewing && p.in_check}
          boardStyle={look.board}
          pieceSet={look.pieces}
          onMove={(u) => void move(u)}
          flash={flash}
        />
        <aside className="chess-side panel">
          <p className="chess-you">
            You play <strong>{me === "w" ? "White ♔" : "Black ♚"}</strong>
          </p>
          <MoveList san={viewing ? sanOf(p.start_fen, p.solution!.slice(0, step!)) : p.san} startsBlack={me === "b"} startNumber={Number(p.start_fen.split(" ")[5]) || 1} />
          {open && <p className="hint">A wrong move isn't played; it just costs one of your 3 tries. Any move that still mates in time counts.</p>}
        </aside>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!open && (
        <div className="result-card">
          <MyReaction pose={p.status === "solved" ? "cheer" : "sad"} />
          {p.solution && (
            <div className="game-controls">
              <span>Solution:</span>
              <button className="btn-sm" disabled={(step ?? 0) <= 0} onClick={() => setStep((s) => Math.max(0, (s ?? 0) - 1))}>
                ◀
              </button>
              <span>
                {step ?? 0}/{p.solution.length}
              </span>
              <button
                className="btn-sm"
                disabled={(step ?? 0) >= p.solution.length}
                onClick={() => setStep((s) => Math.min(p.solution!.length, (s ?? 0) + 1))}
              >
                ▶
              </button>
              {viewing && (
                <button className="btn-ghost btn-sm" onClick={() => setStep(null)}>
                  Back to my game
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="game-controls">
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      {!open && <SaveScorePrompt />}
      <p className="hint">Solve with no mistakes: 40 coins + 30 points. 1 mistake: 25 + 20. 2 mistakes: 15 + 10. A 7-day streak earns a title.</p>
    </div>
  );
}
