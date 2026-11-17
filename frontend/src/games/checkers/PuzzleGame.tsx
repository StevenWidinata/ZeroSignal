import { useEffect, useMemo, useState } from "react";
import { checkers } from "../../api/client";
import type { CheckersPuzzle } from "../../api/types";
import { MyReaction } from "../../character/Live";
import ShareDaily from "../../components/dailies/ShareDaily";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Board from "./Board";
import { SIDE_LABEL, SidePanel } from "./common";
import { Game, parsePath } from "./rules";

/** Today's "win in N": the server checks every move and Zero-Bot defends. */
export default function PuzzleGame({ look, onExit }: { look: { board: string; pieces: string }; onExit: () => void }) {
  const [p, setP] = useState<CheckersPuzzle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Stepping through the solution after the puzzle ends (null = your game). */
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    checkers
      .puzzle()
      .then(setP)
      .catch((e) => setError(e instanceof Error ? e.message : "could not load today's puzzle"));
  }, []);

  const solutionCells = useMemo(() => {
    if (!p?.solution || step === null) return null;
    const g = new Game(p.start_cells, p.side);
    for (const mv of p.solution.slice(0, step)) {
      const path = parsePath(mv);
      if (path) g.playPath(path);
    }
    return g.cells;
  }, [p, step]);

  async function move(mv: string) {
    if (!p || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await checkers.puzzleMove(mv);
      setP(next);
      if (next.correct) {
        if (next.status === "solved") {
          playSfx("win");
          setNote("🧩 Solved!");
          useWallet.getState().celebrate(next.rewards);
        } else {
          playSfx(mv.includes("x") ? "clank" : "drop");
          setNote(`✓ Right! Zero-Bot answered ${next.reply}. Keep going.`);
        }
      } else {
        playSfx(next.status === "failed" ? "lose" : "whiff");
        setNote(next.status === "failed" ? "Out of tries." : `✗ That doesn't win in time. ${next.mistakes_left} tries left.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "move failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !p)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!p) return <div className="loading">Loading today's puzzle</div>;

  const open = p.status === "new" || p.status === "playing";
  const leftForYou = p.win_in - Math.floor(p.moves.length / 2);
  let status: string;
  if (p.status === "solved") status = `🧩 Solved! ${p.points ? `+${p.points} pts. ` : ""}Come back tomorrow for a new one.`;
  else if (p.status === "failed") status = "Out of tries. Step through the solution below, and try again tomorrow!";
  else if (busy) status = "Checking…";
  else status = `${SIDE_LABEL[p.side]} to move and win in ${leftForYou} (leave Zero-Bot with no move).`;
  const hearts = "❤️".repeat(p.mistakes_left) + "🖤".repeat(Math.max(0, 3 - p.mistakes_left));
  const viewing = solutionCells !== null;

  return (
    <div className="c4-play ck-play">
      <div className="status-bar" role="status" aria-live="polite">
        Puzzle #{p.number} · <span aria-label={`${p.mistakes_left} tries left`}>{hearts}</span> · 🔥 {p.streak} day streak
      </div>
      <p className="ck-puzzle-status">{status}</p>
      <div className="ck-layout">
        <Board
          cells={viewing ? solutionCells : p.cells}
          bottom={p.side}
          legal={open && !busy ? p.legal : []}
          lastMove={viewing ? (p.solution?.[step! - 1] ?? null) : (p.moves[p.moves.length - 1] ?? null)}
          boardStyle={look.board}
          pieceSet={look.pieces}
          onMove={(m) => void move(m)}
        />
        <SidePanel first={p.side} you={`You play ${SIDE_LABEL[p.side]}`} cells={viewing ? solutionCells : p.cells} moves={p.moves} extra={note && <p>{note}</p>} />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!open && (
        <div className="panel wam-results">
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
          <ShareDaily
            gameId="checkers"
            headline={p.status === "solved" ? `🧩 Solved win in ${p.win_in}${p.points ? ` · ${p.points} pts` : ""}` : "❌ Not solved today"}
            detail={`${"❤️".repeat(p.mistakes_left)}${"🖤".repeat(Math.max(0, 3 - p.mistakes_left))} · 🔥 ${p.streak} day streak`}
          />
          <SaveScorePrompt />
        </div>
      )}
      <div className="game-controls">
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      <p className="hint">Solve with no mistakes: 40 coins + 30 points. 1 mistake: 25 + 20. 2 mistakes: 15 + 10. A 7-day streak earns a title.</p>
    </div>
  );
}
