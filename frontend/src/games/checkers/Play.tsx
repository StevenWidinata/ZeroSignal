import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { checkers } from "../../api/client";
import type { CheckersCollection, CheckersGame, CheckersLevel, CheckersSide } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import OnlineLobby from "../../online/OnlineLobby";
import { playSfx } from "../../platform/sound";
import { useAuth } from "../../store/auth";
import AiGame from "./AiGame";
import "./checkers.css";
import { BoardSwatch, LEVEL_LABEL, PiecesSwatch } from "./common";
import { BOARDS, PIECE_SETS } from "./items";
import LocalGame from "./LocalGame";
import { useLook, type Look } from "./look";
import OnlineCheckers from "./OnlineCheckers";
import PuzzleGame from "./PuzzleGame";
import Shop from "./Shop";

type Mode = "ai" | "local" | "online" | "puzzle";
type Screen =
  | { kind: "menu" }
  | { kind: "ai"; game: CheckersGame }
  | { kind: "local" }
  | { kind: "online"; code: string }
  | { kind: "puzzle" }
  | { kind: "shop" };

const LEVELS: { id: CheckersLevel; blurb: string; reward: string }[] = [
  { id: "easy", blurb: "Learning the game. Often misses jumps that hurt.", reward: "8 coins" },
  { id: "medium", blurb: "Sees simple shots and trades.", reward: "20 coins" },
  { id: "hard", blurb: "Looks several moves ahead.", reward: "40 coins" },
  { id: "master", blurb: "Deep search, strong endgames. Good luck!", reward: "90 coins" },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "ai", label: "🤖 vs Zero-Bot" },
  { id: "puzzle", label: "📅 Daily puzzle" },
  { id: "online", label: "🌐 Online" },
  { id: "local", label: "👥 Same device" },
];

function LookPicker({ look, onLook, collection }: { look: Look; onLook: (l: Look) => void; collection: CheckersCollection | null }) {
  const owned = (kind: "boards" | "pieces", all: { id: string; price: number | null }[]) =>
    new Set(collection ? collection[kind].filter((i) => i.owned).map((i) => i.id) : all.filter((i) => i.price === null).map((i) => i.id));
  const ownedBoards = owned("boards", BOARDS);
  const ownedPieces = owned("pieces", PIECE_SETS);
  const row = (legend: string, list: { id: string; name: string }[], mine: Set<string>, value: string, set: (id: string) => void, swatch: (id: string) => React.ReactNode) => (
    <fieldset className="c4-skins">
      <legend>{legend}</legend>
      {list.map((it) => {
        const locked = !mine.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            className={`c4-skin${value === it.id ? " selected" : ""}`}
            disabled={locked}
            aria-pressed={value === it.id}
            title={locked ? `${it.name} (locked)` : it.name}
            aria-label={`${it.name}${locked ? ", locked" : ""}`}
            onClick={() => set(it.id)}
          >
            {swatch(it.id)}
            {locked && (
              <span className="c4-lock" aria-hidden="true">
                🔒
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
  return (
    <>
      {row("Board", BOARDS, ownedBoards, look.board, (id) => onLook({ ...look, board: id }), (id) => <BoardSwatch id={id} size={40} />)}
      {row("Pieces", PIECE_SETS, ownedPieces, look.pieces, (id) => onLook({ ...look, pieces: id }), (id) => <PiecesSwatch id={id} size={40} />)}
    </>
  );
}

export default function Play() {
  const username = useAuth((s) => s.user?.username ?? "Player 1");
  const [params, setParams] = useSearchParams();
  const roomParam = params.get("room");
  const [screen, setScreen] = useState<Screen>(roomParam ? { kind: "online", code: roomParam.toUpperCase() } : { kind: "menu" });
  const [mode, setMode] = useState<Mode>(roomParam ? "online" : params.get("mode") === "puzzle" ? "puzzle" : "ai");
  const [level, setLevel] = useState<CheckersLevel>("easy");
  const [side, setSide] = useState<CheckersSide | "random">("dark");
  const [look, setLook] = useLook();
  const [collection, setCollection] = useState<CheckersCollection | null>(null);
  const [resume, setResume] = useState<CheckersGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  function refresh() {
    checkers.collection().then(setCollection).catch(() => setCollection(null));
    checkers.active().then(setResume).catch(() => setResume(null));
  }
  useEffect(refresh, []);

  // A style you no longer own (or never did on this account) falls back to the free default.
  const usable: Look = {
    board: !collection || collection.boards.some((b) => b.id === look.board && b.owned) ? look.board : "classic",
    pieces: !collection || collection.pieces.some((p) => p.id === look.pieces && p.owned) ? look.pieces : "classic",
  };

  async function startAi() {
    setStarting(true);
    setError(null);
    try {
      const g = await checkers.create(level, side, usable.board, usable.pieces);
      playSfx("click");
      setResume(null);
      setScreen({ kind: "ai", game: g });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start");
    } finally {
      setStarting(false);
    }
  }

  function back() {
    setScreen({ kind: "menu" });
    refresh();
  }

  const header = (
    <GameHeader
      gameId="checkers"
      tag={
        <>
          {screen.kind === "ai" && <span className="tag tag-blue">vs Zero-Bot · {LEVEL_LABEL[screen.game.level]}</span>}
          {screen.kind === "local" && <span className="tag">2 players</span>}
          {screen.kind === "online" && <span className="tag tag-yellow">🌐 Online · {screen.code}</span>}
          {screen.kind === "puzzle" && <span className="tag">📅 Daily puzzle</span>}
        </>
      }
    />
  );

  if (screen.kind === "online")
    return (
      <>
        {header}
        <OnlineCheckers
          code={screen.code}
          look={usable}
          onExit={() => {
            setParams({}, { replace: true });
            setScreen({ kind: "menu" });
          }}
        />
      </>
    );
  if (screen.kind === "ai")
    return (
      <>
        {header}
        <AiGame key={screen.game.id} initial={screen.game} onExit={back} onRematch={(g) => setScreen({ kind: "ai", game: g })} />
      </>
    );
  if (screen.kind === "local")
    return (
      <>
        {header}
        <LocalGame names={[username, "Player 2"]} look={usable} onExit={back} />
      </>
    );
  if (screen.kind === "puzzle")
    return (
      <>
        {header}
        <PuzzleGame look={usable} onExit={back} />
      </>
    );
  if (screen.kind === "shop")
    return (
      <>
        {header}
        <Shop collection={collection} onCollection={setCollection} onBack={back} />
      </>
    );

  return (
    <>
      {header}
      <div className="c4-menu">
        {resume && (
          <div className="panel c4-resume">
            <span>
              Unfinished game vs <strong>Zero-Bot · {LEVEL_LABEL[resume.level]}</strong> ({Math.ceil(resume.moves.length / 2)} moves in)
            </span>
            <button className="btn-green btn-sm" onClick={() => setScreen({ kind: "ai", game: resume })}>
              ▶ Resume
            </button>
          </div>
        )}

        <div className="panel c4-panel">
          <div className="segmented c4-modes" role="radiogroup" aria-label="Game mode">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "" : "btn-ghost"} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>

          {mode === "online" && (
            <OnlineLobby
              game="checkers"
              onEnter={(code) => {
                setParams({ room: code }, { replace: true });
                setScreen({ kind: "online", code });
              }}
            />
          )}

          {mode === "ai" && (
            <>
              <fieldset className="c4-diffs ck-levels">
                <legend>Zero-Bot level</legend>
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`c4-diff diff-${l.id === "master" ? "impossible" : l.id}${level === l.id ? " selected" : ""}`}
                    aria-pressed={level === l.id}
                    onClick={() => setLevel(l.id)}
                  >
                    <strong>{LEVEL_LABEL[l.id]}</strong>
                    <small>{l.blurb}</small>
                    <small>Win: {l.reward}</small>
                  </button>
                ))}
              </fieldset>
              <div className="row-label">
                <span id="ck-side">
                  You play
                  <small>Dark moves first.</small>
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="ck-side">
                  {(["dark", "random", "light"] as const).map((s) => (
                    <button key={s} role="radio" aria-checked={side === s} className={`btn-sm${side === s ? "" : " btn-ghost"}`} onClick={() => setSide(s)}>
                      {s === "dark" ? "⚫ Dark" : s === "light" ? "⚪ Light" : "🎲 Random"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "puzzle" && (
            <div className="ck-mode-blurb">
              <h3>📅 Today's puzzle</h3>
              <p>
                Everyone gets the same "win in 2–4" each day (it changes at midnight WIB). Find the moves that leave Zero-Bot with no
                move at all. Zero-Bot defends as well as it can. You have 3 tries.
              </p>
            </div>
          )}
          {mode === "local" && (
            <div className="ck-mode-blurb">
              <h3>👥 Pass and play</h3>
              <p>Two players on this device. The board turns around for each player (you can switch that off). Just for fun: no coins or points.</p>
            </div>
          )}

          <LookPicker look={usable} onLook={setLook} collection={collection} />

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {mode !== "online" && (
            <div className="game-controls">
              {mode === "ai" && (
                <button className="btn-green" onClick={() => void startAi()} disabled={starting}>
                  {starting ? "Starting…" : "▶ Start game"}
                </button>
              )}
              {mode === "puzzle" && (
                <button className="btn-green" onClick={() => setScreen({ kind: "puzzle" })}>
                  ▶ Open today's puzzle
                </button>
              )}
              {mode === "local" && (
                <button
                  className="btn-green"
                  onClick={() => {
                    playSfx("click");
                    setScreen({ kind: "local" });
                  }}
                >
                  ▶ Start game
                </button>
              )}
              <button className="btn" onClick={() => setScreen({ kind: "shop" })}>
                🛍 Boards & pieces
              </button>
            </div>
          )}
          {resume && mode === "ai" && <p className="hint">Starting a new game resigns your unfinished one.</p>}
          {mode === "ai" && (
            <p className="hint">Beat Zero-Bot for coins and XP (more for harder levels). Wins vs Hard or Master can drop a new board or piece set.</p>
          )}
        </div>
      </div>
    </>
  );
}
