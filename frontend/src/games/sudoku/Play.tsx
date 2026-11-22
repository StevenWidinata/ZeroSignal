import { useEffect, useState } from "react";
import { api, sudoku } from "../../api/client";
import type { DailyView, SudokuCollection, SudokuGame, SudokuMode } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Game, { MODE_NAME } from "./Game";
import { THEMES, findTheme, useTheme } from "./items";
import "./sudoku.css";

const LEVELS: { id: Exclude<SudokuMode, "daily">; icon: string; givens: string; par: string; coins: number; blurb: string }[] = [
  { id: "easy", icon: "🌱", givens: "~40 numbers given", par: "par 5 min", coins: 5, blurb: "Every square follows from simple looks." },
  { id: "medium", icon: "🌿", givens: "~32 numbers given", par: "par 8 min", coins: 15, blurb: "Find where each number must go." },
  { id: "hard", icon: "🌲", givens: "~27 numbers given", par: "par 12 min", coins: 35, blurb: "Needs pairs and pointing lines." },
  { id: "expert", icon: "🔥", givens: "~26 numbers given", par: "par 20 min", coins: 70, blurb: "Triples and X-Wings. Never a guess." },
];

/** A small 3×3 preview of a theme. */
function Swatch({ id }: { id: string }) {
  const a = findTheme(id).art;
  return (
    <span className="sd-swatch" style={{ background: a.box, borderColor: a.box }} aria-hidden="true">
      {[5, 0, 3, 0, 7, 0, 9, 0, 1].map((d, i) => (
        <span key={i} style={{ background: i === 4 ? a.select : a.cell, color: d === 7 ? a.entry : a.given }}>
          {d || ""}
        </span>
      ))}
    </span>
  );
}

export default function Play() {
  const [game, setGame] = useState<SudokuGame | null>(null);
  const [resume, setResume] = useState<SudokuGame | null>(null);
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [collection, setCollection] = useState<SudokuCollection | null>(null);
  const [theme, setTheme] = useTheme();
  const [starting, setStarting] = useState<SudokuMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);

  function loadMenu() {
    sudoku
      .active()
      .then(setResume)
      .catch(() => setResume(null));
    api
      .dailies()
      .then((l) => setDaily(l.find((d) => d.game_id === "sudoku") ?? null))
      .catch(() => setDaily(null));
    sudoku
      .collection()
      .then(setCollection)
      .catch(() => setCollection(null));
  }
  useEffect(loadMenu, []);

  // Wear a theme only while you own it (free ones always).
  const owned = (id: string) => findTheme(id).price === null || !!collection?.themes.find((t) => t.id === id)?.owned;
  const shownTheme = owned(theme) ? theme : THEMES[0].id;

  async function start(mode: SudokuMode) {
    setStarting(mode);
    setError(null);
    try {
      const g = await sudoku.create(mode);
      playSfx("click");
      setResume(null);
      setGame(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start a puzzle");
    } finally {
      setStarting(null);
    }
  }

  async function buy(id: string) {
    setBusy(true);
    setError(null);
    try {
      setCollection(await sudoku.buy(id));
      setTheme(id);
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that theme");
    } finally {
      setBusy(false);
    }
  }

  const header = <GameHeader gameId="sudoku" tag={game ? <span className="tag">{MODE_NAME[game.mode]}</span> : null} />;

  if (game) {
    return (
      <>
        {header}
        <Game
          key={game.id}
          initial={game}
          theme={shownTheme}
          onNew={() => void start(game.mode === "daily" ? "medium" : game.mode)}
          onMenu={() => {
            setGame(null);
            loadMenu();
          }}
        />
      </>
    );
  }

  const dailyDone = daily?.status === "done";
  const dailyText =
    daily?.status === "done"
      ? `Solved today${daily.score ? ` · ${daily.score.toLocaleString()} pts` : ""}${daily.rank ? ` · #${daily.rank} of ${Math.max(daily.players, daily.rank)}` : ""}`
      : daily?.status === "playing"
        ? "In progress: finish it today"
        : "Medium · the same puzzle for everyone today · one try";

  return (
    <>
      {header}
      <div className="c4-menu sd-menu">
        {resume && (
          <div className="panel c4-resume">
            <span>
              Unfinished <strong>{MODE_NAME[resume.mode]}</strong> puzzle
            </span>
            <button className="btn-green btn-sm" onClick={() => setGame(resume)}>
              ▶ Resume
            </button>
          </div>
        )}

        <div className="panel sd-daily">
          <span className="sd-daily-icon" aria-hidden="true">
            📅
          </span>
          <span className="sd-daily-text">
            <strong>Today's Daily</strong>
            <small>{dailyText}</small>
          </span>
          <button className={dailyDone ? "btn-ghost btn-sm" : "btn-green btn-sm"} onClick={() => void start("daily")} disabled={dailyDone || starting !== null}>
            {starting === "daily" ? "Starting…" : dailyDone ? "✓ Done" : daily?.status === "playing" ? "▶ Continue" : "▶ Play"}
          </button>
        </div>

        <div className="panel c4-panel">
          <fieldset className="wam-modes sd-levels">
            <legend>Pick a level</legend>
            {LEVELS.map((l) => (
              <button key={l.id} type="button" className="wam-mode" onClick={() => void start(l.id)} disabled={starting !== null}>
                <span className="wam-mode-icon" aria-hidden="true">
                  {l.icon}
                </span>
                <strong>{starting === l.id ? "Starting…" : MODE_NAME[l.id]}</strong>
                <small>{l.givens}</small>
                <small>
                  {l.par} · {l.coins} coins
                </small>
                <small>{l.blurb}</small>
              </button>
            ))}
          </fieldset>
          <p className="wam-hint">
            Every puzzle has exactly one solution and needs no guessing. Nothing is checked until the grid is full: then press{" "}
            <strong>Check</strong> and wrong squares turn red while the clock keeps running. Hints fill a square and say why (+30 s, 3 per
            puzzle). Faster solves score more.
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="panel sd-themes">
          <h3>
            🎨 Board theme <small>· you have 🪙 {coins.toLocaleString()}</small>
          </h3>
          <ul className="sd-theme-list">
            {THEMES.map((t) => {
              const have = owned(t.id);
              const on = shownTheme === t.id;
              return (
                <li key={t.id} className={`sd-theme rarity-${t.rarity}${on ? " selected" : ""}`}>
                  <button
                    type="button"
                    className="sd-theme-pick"
                    onClick={() => have && setTheme(t.id)}
                    disabled={!have}
                    aria-pressed={on}
                    aria-label={`${t.name}${have ? (on ? " (in use)" : "") : " (locked)"}`}
                  >
                    <Swatch id={t.id} />
                    <span>{t.name}</span>
                  </button>
                  {!have &&
                    (collection ? (
                      <button className="btn-green btn-sm" onClick={() => void buy(t.id)} disabled={busy || coins < (t.price ?? 0)}>
                        🪙 {t.price?.toLocaleString()}
                      </button>
                    ) : (
                      <small>🔒 {t.price?.toLocaleString()}</small>
                    ))}
                </li>
              );
            })}
          </ul>
          <p className="hint">Wins on Hard or Expert can also drop a theme for free (20% chance).</p>
        </div>
      </div>
    </>
  );
}
