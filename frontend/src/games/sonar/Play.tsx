import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sonar } from "../../api/client";
import type { SonarCollection, SonarGame, SonarLevel } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import OnlineLobby from "../../online/OnlineLobby";
import { playSfx } from "../../platform/sound";
import { useAuth } from "../../store/auth";
import AiGame, { LEVEL_LABEL } from "./AiGame";
import Campaign from "./Campaign";
import { MISSIONS, missionById } from "./missions";
import DailyHunt from "./DailyHunt";
import { FLEETS, SEAS } from "./items";
import LocalGame from "./LocalGame";
import { useLook, type Look } from "./look";
import OnlineSonar from "./OnlineSonar";
import Placement from "./Placement";
import Shop from "./Shop";
import "./sonar.css";
import { FleetSwatch, SeaSwatch } from "./Swatches";
import { FLEET } from "./rules";
import { BOT_MK, MINES, MK_NAME, POWERS } from "./tactics";
import Workshop from "./Workshop";

type Mode = "ai" | "campaign" | "daily" | "online" | "local";
type Screen =
  | { kind: "menu" }
  | { kind: "place" }
  | { kind: "ai"; game: SonarGame }
  | { kind: "daily" }
  | { kind: "local" }
  | { kind: "online"; code: string }
  | { kind: "shop" }
  | { kind: "workshop" };

const LEVELS: { id: SonarLevel; blurb: string; reward: string }[] = [
  { id: "easy", blurb: "Fires all over the place.", reward: "6 coins" },
  { id: "medium", blurb: "Hunts around its hits.", reward: "15 coins" },
  { id: "hard", blurb: "Works out where your ships must be.", reward: "30 coins" },
  { id: "master", blurb: "Hard, plus clever sonar pings.", reward: "60 coins" },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "ai", label: "🤖 vs Zero-Bot" },
  { id: "campaign", label: "🎖️ Campaign" },
  { id: "daily", label: "📅 Daily Hunt" },
  { id: "online", label: "🌐 Online" },
  { id: "local", label: "👥 Same device" },
];

function LookPicker({ look, onLook, collection }: { look: Look; onLook: (l: Look) => void; collection: SonarCollection | null }) {
  const owned = (kind: "fleets" | "seas", id: string) =>
    collection ? collection[kind].some((i) => i.id === id && i.owned) : (kind === "fleets" ? FLEETS : SEAS).some((i) => i.id === id && i.price === null);
  const picker = (kind: "fleets" | "seas") => (
    <fieldset className="c4-skins">
      <legend>{kind === "fleets" ? "Fleet" : "Sea"}</legend>
      {(kind === "fleets" ? FLEETS : SEAS).map((it) => {
        const locked = !owned(kind, it.id);
        const value = kind === "fleets" ? look.fleet : look.sea;
        return (
          <button
            key={it.id}
            type="button"
            className={`c4-skin${value === it.id ? " selected" : ""}`}
            disabled={locked}
            aria-pressed={value === it.id}
            title={locked ? `${it.name} (locked)` : it.name}
            aria-label={`${it.name}${locked ? ", locked" : ""}`}
            onClick={() => onLook(kind === "fleets" ? { ...look, fleet: it.id } : { ...look, sea: it.id })}
          >
            {kind === "fleets" ? <FleetSwatch id={it.id} size={40} /> : <SeaSwatch id={it.id} size={40} />}
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
      {picker("fleets")}
      {picker("seas")}
    </>
  );
}

export default function Play() {
  const username = useAuth((s) => s.user?.username ?? "Player 1");
  const [params, setParams] = useSearchParams();
  const roomParam = params.get("room");
  const [screen, setScreen] = useState<Screen>(roomParam ? { kind: "online", code: roomParam.toUpperCase() } : { kind: "menu" });
  const [mode, setMode] = useState<Mode>(roomParam ? "online" : params.get("daily") ? "daily" : "ai");
  const [level, setLevel] = useState<SonarLevel>("easy");
  /** The Campaign mission being placed / played (null = a normal game). */
  const [mission, setMission] = useState<number | null>(null);
  const [look, setLook] = useLook();
  const [collection, setCollection] = useState<SonarCollection | null>(null);
  const [resume, setResume] = useState<SonarGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  function refresh() {
    sonar.collection().then(setCollection).catch(() => setCollection(null));
    sonar.active().then(setResume).catch(() => setResume(null));
  }
  useEffect(refresh, []);

  // A look you don't own on this account falls back to the free default.
  const usable: Look = {
    fleet: !collection || collection.fleets.some((f) => f.id === look.fleet && f.owned) ? look.fleet : "navy",
    sea: !collection || collection.seas.some((s) => s.id === look.sea && s.owned) ? look.sea : "ocean",
  };

  async function startAi(fleet: string) {
    setStarting(true);
    setError(null);
    try {
      const m = missionById(mission);
      const g = m
        ? await sonar.createMission(m.id, m.level, fleet, usable.fleet, usable.sea)
        : await sonar.create(level, fleet, usable.fleet, usable.sea);
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
      gameId="sonar"
      tag={
        <>
          {(() => {
            const m = missionById(screen.kind === "ai" ? screen.game.op : screen.kind === "place" ? mission : null);
            return m ? <span className="tag tag-green">🎖️ Mission {m.id} · {m.name}</span> : null;
          })()}
          {((screen.kind === "ai" && !screen.game.op) || (screen.kind === "place" && !mission)) && (
            <span className="tag tag-blue">vs Zero-Bot · {LEVEL_LABEL[screen.kind === "ai" ? screen.game.level : level]}</span>
          )}
          {screen.kind === "ai" && screen.game.mode === "classic" && <span className="tag">🎯 Classic</span>}
          {screen.kind === "daily" && <span className="tag tag-green">📅 Daily Hunt</span>}
          {screen.kind === "local" && <span className="tag">2 players</span>}
          {screen.kind === "online" && <span className="tag tag-yellow">🌐 Online · {screen.code}</span>}
        </>
      }
    />
  );

  let body: React.ReactNode = null;
  if (screen.kind === "online")
    body = (
      <OnlineSonar
        code={screen.code}
        look={usable}
        onExit={() => {
          setParams({}, { replace: true });
          setScreen({ kind: "menu" });
        }}
      />
    );
  else if (screen.kind === "place")
    body = (
      <>
        <Placement
          sea={usable.sea}
          fleetSkin={usable.fleet}
          mines={MINES}
          title={mission ? `Mission ${mission}: hide your fleet` : "Hide your fleet from Zero-Bot"}
          doneLabel="▶ Start the battle"
          busy={starting}
          onDone={(f) => void startAi(f)}
        />
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="game-controls">
          <button className="btn-ghost" onClick={back}>
            ← Back to menu
          </button>
        </div>
      </>
    );
  else if (screen.kind === "ai") {
    const op = screen.game.op;
    body = (
      <AiGame
        key={screen.game.id}
        initial={screen.game}
        onExit={back}
        onRematch={() => {
          setMission(op);
          setScreen({ kind: "place" });
        }}
        onNextMission={
          op && op < MISSIONS.length
            ? () => {
                setMission(op + 1);
                setScreen({ kind: "place" });
              }
            : undefined
        }
      />
    );
  }
  else if (screen.kind === "daily") body = <DailyHunt look={usable} onExit={back} />;
  else if (screen.kind === "local") body = <LocalGame names={[username, "Player 2"]} look={usable} onExit={back} />;
  else if (screen.kind === "shop") body = <Shop collection={collection} onCollection={setCollection} onBack={back} />;
  else if (screen.kind === "workshop") body = <Workshop onBack={back} />;
  if (body)
    return (
      <>
        {header}
        {body}
      </>
    );

  return (
    <>
      {header}
      <div className="c4-menu">
        {resume && (
          <div className="panel c4-resume">
            <span>
              {resume.op ? (
                <>
                  Unfinished <strong>Mission {resume.op}: {missionById(resume.op)?.name}</strong> ({resume.target.shots} {resume.target.shots === 1 ? "move" : "moves"} in)
                </>
              ) : (
                <>
                  Unfinished {resume.mode === "classic" ? "Classic " : ""}battle vs <strong>Zero-Bot · {LEVEL_LABEL[resume.level]}</strong> ({resume.target.shots}{" "}
                  shots in)
                </>
              )}
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

          {(mode === "ai" || mode === "local") && (
            <div className="sonar-rules-pick">
              <h3>⚡ Every ship has a power</h3>
              <p className="hint">
                Each power recharges while its ship is afloat, and it's gone when that ship sinks. You also get 2 sonar pings, hide 2 mines,
                shoot supply crates for prizes, and 3 hits in a row fill Overdrive.
              </p>
              <ul className="sonar-power-list">
                {POWERS.map((p, i) => (
                  <li key={p.id}>
                    <span aria-hidden="true">{p.icon}</span> <strong>{p.name}</strong> <small>({FLEET[i].name})</small>: {p.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === "campaign" && (
            <Campaign
              onPlay={(op) => {
                setMission(op);
                setScreen({ kind: "place" });
              }}
            />
          )}
          {mode === "online" && (
            <OnlineLobby
              game="sonar"
              onEnter={(code) => {
                setParams({ room: code }, { replace: true });
                setScreen({ kind: "online", code });
              }}
            />
          )}
          {mode === "ai" && (
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
                  <small>Its powers: {MK_NAME[BOT_MK[l.id]]}</small>
                </button>
              ))}
            </fieldset>
          )}
          {mode === "daily" && (
            <div className="sonar-mode-blurb">
              <h3>📅 Today's hunt</h3>
              <p>Everyone hunts the same hidden fleet today (a new one at midnight WIB). Sink it in as few shots as you can; pings count as shots. One try a day.</p>
            </div>
          )}
          {mode === "local" && (
            <div className="sonar-mode-blurb">
              <h3>👥 Pass and play</h3>
              <p>Each player hides a fleet, then you take turns. A cover screen hides the boards between turns. Just for fun: no coins or points.</p>
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
                <button
                  className="btn-green"
                  onClick={() => {
                    setMission(null);
                    setScreen({ kind: "place" });
                  }}
                >
                  ▶ Hide my fleet
                </button>
              )}
              {mode === "daily" && (
                <button className="btn-green" onClick={() => setScreen({ kind: "daily" })}>
                  ▶ Start today's hunt
                </button>
              )}
              {mode === "local" && (
                <button className="btn-green" onClick={() => setScreen({ kind: "local" })}>
                  ▶ Start
                </button>
              )}
              <button className="btn" onClick={() => setScreen({ kind: "shop" })}>
                🛍 Fleets & seas
              </button>
              {(mode === "ai" || mode === "campaign") && (
                <button className="btn" onClick={() => setScreen({ kind: "workshop" })}>
                  🔧 Workshop
                </button>
              )}
            </div>
          )}
          {resume && (mode === "ai" || mode === "campaign") && <p className="hint">Starting a new battle gives up your unfinished one.</p>}
          {mode === "ai" && <p className="hint">Sink Zero-Bot's fleet for coins and XP (more on harder levels). Wins vs Hard or Master can drop a new fleet or sea.</p>}
        </div>
      </div>
    </>
  );
}
