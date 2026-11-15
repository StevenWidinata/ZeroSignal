import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { chess } from "../../api/client";
import type { ChessCollection, ChessGame, ChessLevel, ChessSide } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import OnlineLobby from "../../online/OnlineLobby";
import { playSfx } from "../../platform/sound";
import { useAuth } from "../../store/auth";
import AiGame, { LEVEL_LABEL } from "./AiGame";
import "./chess.css";
import { BOARDS, PIECE_SETS } from "./items";
import LocalGame from "./LocalGame";
import { useLook, type Look } from "./look";
import OnlineChess from "./OnlineChess";
import PuzzleGame from "./PuzzleGame";
import Shop from "./Shop";
import { BoardSwatch, PiecesSwatch } from "./Swatches";

type Mode = "ai" | "local" | "online" | "puzzle";
type Screen =
  | { kind: "menu" }
  | { kind: "ai"; game: ChessGame }
  | { kind: "local" }
  | { kind: "online"; code: string }
  | { kind: "puzzle" }
  | { kind: "shop" };

const LEVELS: { id: ChessLevel; blurb: string; reward: string }[] = [
  { id: "easy", blurb: "Learning the moves. Makes mistakes.", reward: "8 coins" },
  { id: "medium", blurb: "Spots simple tricks.", reward: "20 coins" },
  { id: "hard", blurb: "Looks 3 moves deep. Rarely gives pieces away.", reward: "40 coins" },
  { id: "master", blurb: "Deep search. Good luck!", reward: "90 coins" },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "ai", label: "🤖 vs Zero-Bot" },
  { id: "puzzle", label: "📅 Daily puzzle" },
  { id: "online", label: "🌐 Online" },
  { id: "local", label: "👥 Same device" },
];

function LookPicker({ look, onLook, collection }: { look: Look; onLook: (l: Look) => void; collection: ChessCollection | null }) {
  const ownedBoards = new Set(collection ? collection.boards.filter((b) => b.owned).map((b) => b.id) : BOARDS.filter((b) => b.price === null).map((b) => b.id));
  const ownedPieces = new Set(collection ? collection.pieces.filter((p) => p.owned).map((p) => p.id) : PIECE_SETS.filter((p) => p.price === null).map((p) => p.id));
  return (
    <>
      <fieldset className="c4-skins">
        <legend>Board</legend>
        {BOARDS.map((b) => {
          const locked = !ownedBoards.has(b.id);
          return (
            <button
              key={b.id}
              type="button"
              className={`c4-skin${look.board === b.id ? " selected" : ""}`}
              disabled={locked}
              aria-pressed={look.board === b.id}
              title={locked ? `${b.name} (locked)` : b.name}
              aria-label={`${b.name}${locked ? ", locked" : ""}`}
              onClick={() => onLook({ ...look, board: b.id })}
            >
              <BoardSwatch id={b.id} size={40} />
              {locked && (
                <span className="c4-lock" aria-hidden="true">
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
      <fieldset className="c4-skins">
        <legend>Pieces</legend>
        {PIECE_SETS.map((p) => {
          const locked = !ownedPieces.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`c4-skin${look.pieces === p.id ? " selected" : ""}`}
              disabled={locked}
              aria-pressed={look.pieces === p.id}
              title={locked ? `${p.name} (locked)` : p.name}
              aria-label={`${p.name}${locked ? ", locked" : ""}`}
              onClick={() => onLook({ ...look, pieces: p.id })}
            >
              <PiecesSwatch id={p.id} size={40} />
              {locked && (
                <span className="c4-lock" aria-hidden="true">
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
    </>
  );
}

export default function Play() {
  const username = useAuth((s) => s.user?.username ?? "Player 1");
  const [params, setParams] = useSearchParams();
  const roomParam = params.get("room");
  const [screen, setScreen] = useState<Screen>(roomParam ? { kind: "online", code: roomParam.toUpperCase() } : { kind: "menu" });
  const [mode, setMode] = useState<Mode>(roomParam ? "online" : params.get("mode") === "puzzle" ? "puzzle" : "ai");
  const [level, setLevel] = useState<ChessLevel>("easy");
  const [color, setColor] = useState<ChessSide | "random">("white");
  const [look, setLook] = useLook();
  const [collection, setCollection] = useState<ChessCollection | null>(null);
  const [resume, setResume] = useState<ChessGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  function refresh() {
    chess.collection().then(setCollection).catch(() => setCollection(null));
    chess.active().then(setResume).catch(() => setResume(null));
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
      const g = await chess.create(level, color, usable.board, usable.pieces);
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
      gameId="chess"
      tag={
        <>
          {screen.kind === "ai" && <span className="tag tag-blue">vs Zero-Bot · {LEVEL_LABEL[screen.game.level]}</span>}
          {screen.kind === "local" && <span className="tag">2 players</span>}
          {screen.kind === "online" && <span className="tag tag-yellow">🌐 Online · {screen.code}</span>}
          {screen.kind === "puzzle" && <span className="tag tag-green">📅 Daily puzzle</span>}
        </>
      }
    />
  );

  if (screen.kind === "online")
    return (
      <>
        {header}
        <OnlineChess
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
              game="chess"
              onEnter={(code) => {
                setParams({ room: code }, { replace: true });
                setScreen({ kind: "online", code });
              }}
            />
          )}

          {mode === "ai" && (
            <>
              <fieldset className="c4-diffs chess-levels">
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
                <span id="chess-color">You play</span>
                <div className="segmented" role="radiogroup" aria-labelledby="chess-color">
                  {(["white", "random", "black"] as const).map((c) => (
                    <button key={c} role="radio" aria-checked={color === c} className={`btn-sm${color === c ? "" : " btn-ghost"}`} onClick={() => setColor(c)}>
                      {c === "white" ? "♔ White" : c === "black" ? "♚ Black" : "🎲 Random"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "puzzle" && (
            <div className="chess-mode-blurb">
              <h3>📅 Today's puzzle</h3>
              <p>Everyone gets the same "mate in 2" each day (it changes at midnight WIB). Find the winning move, Zero-Bot defends, then finish it. You have 3 tries.</p>
            </div>
          )}
          {mode === "local" && (
            <div className="chess-mode-blurb">
              <h3>👥 Pass and play</h3>
              <p>Two players on this device. The board turns around for each player (you can switch that off). Just for fun: no coins or points.</p>
            </div>
          )}

          {mode !== "online" && <LookPicker look={usable} onLook={setLook} collection={collection} />}

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
          {mode === "online" && <LookPicker look={usable} onLook={setLook} collection={collection} />}
          {resume && mode === "ai" && <p className="hint">Starting a new game resigns your unfinished one.</p>}
          {mode === "ai" && <p className="hint">Beat Zero-Bot for coins and XP (more for harder levels). Wins vs Hard or Master can drop a new board or piece set.</p>}
        </div>
      </div>
    </>
  );
}
