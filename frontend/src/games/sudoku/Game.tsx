import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sudoku } from "../../api/client";
import type { SudokuGame } from "../../api/types";
import { MyReaction } from "../../character/Live";
import ShareDaily from "../../components/dailies/ShareDaily";
import { SaveScorePrompt } from "../../components/Guest";
import { currentAction } from "../../platform/keymap";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Board from "./Board";
import { themeName } from "./items";
import {
  clashes,
  counts,
  emptyNotes,
  formatTime,
  gridCode,
  isFull,
  moveCursor,
  parseGrid,
  placeClearsNotes,
  readNotes,
  toggleNote,
  type Notes,
} from "./logic";

export const MODE_NAME: Record<SudokuGame["mode"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
  daily: "Daily",
};

const SAVE_AFTER_MS = 1200;
const notesKey = (id: string) => `zs.sudoku.notes.${id}`;

function loadNotes(id: string): Notes {
  try {
    return readNotes(localStorage.getItem(notesKey(id)));
  } catch {
    return emptyNotes();
  }
}

function storeNotes(id: string, notes: Notes | null) {
  try {
    if (notes) localStorage.setItem(notesKey(id), JSON.stringify(notes));
    else localStorage.removeItem(notesKey(id));
  } catch {
    /* storage blocked */
  }
}

interface Props {
  initial: SudokuGame;
  theme: string;
  onNew: () => void;
  onMenu: () => void;
}

/** One Sudoku game. Your grid is saved to the server as you play; notes stay in this browser. */
export default function Game({ initial, theme, onNew, onMenu }: Props) {
  const [game, setGame] = useState(initial);
  const givens = useMemo(() => parseGrid(game.givens), [game.givens]);
  const [grid, setGrid] = useState(() => parseGrid(initial.entries));
  const [notes, setNotes] = useState<Notes>(() => loadNotes(initial.id));
  const [cursor, setCursor] = useState(() => Math.max(0, parseGrid(initial.entries).indexOf(0)));
  const [notesMode, setNotesMode] = useState(false);
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ text: string; tone: "hint" | "wrong" } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const synced = useRef({ elapsed: initial.elapsed_ms, at: performance.now() });
  const saved = useRef(initial.entries);
  const boardRef = useRef<HTMLDivElement>(null);

  const playing = game.status === "playing";
  const hinted = useMemo(() => new Set(game.hinted), [game.hinted]);
  const locked = (c: number) => givens[c] !== 0 || hinted.has(c);
  const clash = useMemo(() => clashes(grid), [grid]);
  const placed = useMemo(() => counts(grid), [grid]);
  const full = isFull(grid);
  const solution = game.solution ? parseGrid(game.solution) : null;

  // Clock: the server's time, ticking here between replies.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [playing]);
  const shownMs = game.result?.time_ms ?? (playing ? synced.current.elapsed + (now - synced.current.at) : game.elapsed_ms);

  const apply = useCallback((g: SudokuGame) => {
    synced.current = { elapsed: g.elapsed_ms, at: performance.now() };
    setNow(performance.now());
    setGame(g);
    saved.current = g.entries;
    setGrid(parseGrid(g.entries));
    if (g.status !== "playing") {
      storeNotes(g.id, null);
      setMessage(null);
      if (g.status === "won") {
        playSfx("win");
        useWallet.getState().celebrate(g.result?.rewards);
      }
    }
  }, []);

  // Save your grid a moment after you stop typing (and when you leave).
  const code = gridCode(grid);
  useEffect(() => {
    if (!playing || code === saved.current) return;
    const t = window.setTimeout(() => {
      saved.current = code;
      sudoku.save(game.id, code).catch(() => (saved.current = ""));
    }, SAVE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [code, playing, game.id]);
  const latest = useRef({ code, playing, id: game.id });
  latest.current = { code, playing, id: game.id };
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.playing && l.code !== saved.current) void sudoku.save(l.id, l.code).catch(() => undefined);
    },
    [],
  );
  useEffect(() => {
    if (playing) storeNotes(game.id, notes);
  }, [notes, playing, game.id]);

  async function send(call: () => Promise<SudokuGame>, after?: (g: SudokuGame) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const g = await call();
      apply(g);
      after?.(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function input(d: number) {
    if (!playing || locked(cursor)) return;
    if (notesMode) {
      if (grid[cursor]) return;
      playSfx("tick");
      setNotes((n) => toggleNote(n, cursor, d));
      return;
    }
    playSfx("click");
    setGrid((g) => {
      const next = g.slice();
      next[cursor] = d;
      return next;
    });
    setNotes((n) => placeClearsNotes(n, cursor, d));
    setWrong((w) => {
      if (!w.has(cursor)) return w;
      const next = new Set(w);
      next.delete(cursor);
      return next;
    });
  }

  function erase() {
    if (!playing || locked(cursor)) return;
    playSfx("tick");
    if (grid[cursor]) {
      setGrid((g) => {
        const next = g.slice();
        next[cursor] = 0;
        return next;
      });
      setWrong((w) => {
        const next = new Set(w);
        next.delete(cursor);
        return next;
      });
    } else {
      setNotes((n) => {
        const next = n.slice();
        next[cursor] = 0;
        return next;
      });
    }
  }

  function hint() {
    if (!playing || game.hints_left <= 0) return;
    void send(
      () => sudoku.hint(game.id, code),
      (g) => {
        if (!g.hint) return;
        playSfx("chime");
        setCursor(g.hint.cell);
        setFlash(g.hint.cell);
        window.setTimeout(() => setFlash(null), 1600);
        setNotes((n) => placeClearsNotes(n, g.hint!.cell, g.hint!.digit));
        setMessage({ text: `💡 ${g.hint.reason} (+30 s)`, tone: "hint" });
      },
    );
  }

  function check() {
    if (!playing || !full) return;
    void send(
      () => sudoku.check(game.id, code),
      (g) => {
        if (g.wrong?.length) {
          playSfx("lose");
          setWrong(new Set(g.wrong));
          setMessage({
            text: `✗ ${g.wrong.length === 1 ? "1 square is" : `${g.wrong.length} squares are`} wrong (marked red). Fix ${g.wrong.length === 1 ? "it" : "them"} and press Check again. The clock keeps running.`,
            tone: "wrong",
          });
        }
      },
    );
  }

  // Keys (Settings → Controls).
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      const a = currentAction("sudoku", e.code);
      if (!a) return;
      e.preventDefault();
      if (a === "up" || a === "down" || a === "left" || a === "right") {
        const next = moveCursor(cursor, a);
        setCursor(next);
        boardRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
      } else if (a === "notes") setNotesMode((m) => !m);
      else if (/^n[1-9]$/.test(a)) input(Number(a.slice(1)));
      else if (a === "erase") erase();
      else if (a === "hint") hint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const res = game.result;
  const filled = grid.filter((v, c) => v && !givens[c]).length;
  const toFill = givens.filter((v) => !v).length;

  return (
    <div className="sd-play">
      <div className="sd-layout">
        <div className="sd-board-wrap" ref={boardRef}>
          <Board
            givens={givens}
            grid={grid}
            notes={notes}
            hinted={hinted}
            wrong={wrong}
            clash={clash}
            cursor={cursor}
            flash={flash}
            solution={game.status === "gave_up" ? solution : null}
            theme={theme}
            onPick={(c) => setCursor(c)}
          />
        </div>

        <aside className="sd-side panel" aria-label="Controls">
          <div className="sd-clock" aria-live="off">
            <span>
              <span aria-hidden="true">⏱️</span> <strong>{formatTime(shownMs)}</strong>
            </span>
            <small>
              {filled}/{toFill} filled
            </small>
          </div>

          {playing ? (
            <>
              <div className="sd-pad" role="group" aria-label={notesMode ? "Write a note" : "Put a number"}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`sd-key${notesMode ? " note" : ""}${placed[d] >= 9 ? " done" : ""}`}
                    onClick={() => input(d)}
                    disabled={busy || locked(cursor)}
                    aria-label={`${notesMode ? "Note" : "Number"} ${d}${placed[d] >= 9 ? " (all 9 placed)" : ""}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="sd-tools">
                <button className={`btn-sm${notesMode ? "" : " btn-ghost"}`} aria-pressed={notesMode} onClick={() => setNotesMode((m) => !m)}>
                  ✏️ Notes {notesMode ? "on" : "off"}
                </button>
                <button className="btn-sm btn-ghost" onClick={erase} disabled={busy || locked(cursor)}>
                  ⌫ Erase
                </button>
                <button className="btn-sm btn-ghost" onClick={hint} disabled={busy || game.hints_left <= 0} title="Fills one square you could work out next, and says why. Adds 30 s.">
                  💡 Hint ({game.hints_left})
                </button>
                <button
                  className={`btn-sm${full ? " btn-green" : " btn-ghost"}`}
                  onClick={check}
                  disabled={busy || !full}
                  title={full ? "Check your grid" : "Fill every square to check"}
                >
                  ✔ Check
                </button>
              </div>
              {!full && <p className="sd-note">Check unlocks when every square has a number.</p>}
              <div className="sd-giveup">
                {confirmGiveUp ? (
                  <>
                    <span>Give up and see the solution?</span>
                    <button className="btn-sm" onClick={() => void send(() => sudoku.giveUp(game.id))} disabled={busy}>
                      Yes, give up
                    </button>
                    <button className="btn-sm btn-ghost" onClick={() => setConfirmGiveUp(false)}>
                      Keep playing
                    </button>
                  </>
                ) : (
                  <button className="btn-sm btn-ghost" onClick={() => setConfirmGiveUp(true)} disabled={busy}>
                    🏳️ Give up
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="game-controls">
              {game.mode !== "daily" && (
                <button className="btn-green" onClick={onNew}>
                  ↻ New {MODE_NAME[game.mode]} puzzle
                </button>
              )}
              <button className="btn-ghost" onClick={onMenu}>
                ← Menu
              </button>
            </div>
          )}
        </aside>
      </div>

      {message && (
        <p className={`sd-message ${message.tone}`} role="status">
          {message.text}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {!playing && (
        <div className="panel mf-result sd-result" role="status">
          <MyReaction pose={res?.won ? "cheer" : "sad"} />
          <h2>{res?.won ? "Solved! 🎉" : "Here's the solution"}</h2>
          {res?.won && (
            <p className="mf-score">
              <strong>{(res.score ?? 0).toLocaleString()}</strong> points
              {res.new_best && <span className="tag tag-yellow">★ New best!</span>}
              {!res.new_best && (res.previous_best ?? 0) > 0 && <span className="tag">Best: {(res.previous_best ?? 0).toLocaleString()}</span>}
            </p>
          )}
          <dl className="wam-stats">
            {res?.won && (
              <div>
                <dt>Time</dt>
                <dd>{formatTime(res.time_ms ?? 0)}</dd>
              </div>
            )}
            <div>
              <dt>Hints</dt>
              <dd>{game.hints_used}</dd>
            </div>
            <div>
              <dt>Checks with mistakes</dt>
              <dd>{game.checks}</dd>
            </div>
          </dl>
          {res?.drop && <p className="unlock">🍀 Lucky drop: you won the {themeName(res.drop)} theme!</p>}
          {!res?.won && <p className="wam-hint">The squares you hadn't filled show the solution in a lighter colour.</p>}
          {game.mode === "daily" && res?.won && (
            <ShareDaily
              gameId="sudoku"
              headline={`🔢 Solved in ${formatTime(res.time_ms ?? 0)} · ${(res.score ?? 0).toLocaleString()} pts`}
              detail={`💡 ${game.hints_used} hints · ✔ ${game.checks + 1} ${game.checks === 0 ? "check" : "checks"}`}
            />
          )}
          {res?.won && <SaveScorePrompt />}
        </div>
      )}
    </div>
  );
}
