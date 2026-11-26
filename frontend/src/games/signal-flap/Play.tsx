import { useCallback, useEffect, useState } from "react";
import { signalFlap } from "../../api/client";
import type { FlapCollection, FlapFinish, FlapItemKind, FlapMode, FlapStart } from "../../api/types";
import ShareDaily from "../../components/dailies/ShareDaily";
import { wantsDaily } from "../../components/dailies/logic";
import GameHeader from "../../components/GameHeader";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { Game } from "./engine";
import { LISTS, findDrone, findSky, findTrail, isItem, type DroneArt, type Item } from "./items";
import { DEFAULT_PREFS, MODE_INFO, loadPrefs, savePrefs, type Prefs } from "./modes";
import Results from "./Results";
import Round, { type RoundLook } from "./Round";
import "./flap.css";

type Screen =
  | { kind: "setup" }
  | { kind: "round"; run: FlapStart; game: Game; look: RoundLook }
  | { kind: "submitting" }
  | { kind: "results"; result: FlapFinish };

const KINDS: { kind: FlapItemKind; legend: string }[] = [
  { kind: "drone", legend: "Drone" },
  { kind: "trail", legend: "Trail" },
  { kind: "sky", legend: "Sky" },
];

const listOf = (c: FlapCollection | null, kind: FlapItemKind) => (kind === "drone" ? c?.drones : kind === "trail" ? c?.trails : c?.skies);

/** The drone's outline for its style, in a 40 x 28 box centred on (20, 16). */
function droneShape(a: DroneArt) {
  const common = { fill: a.body, stroke: "rgba(0, 0, 0, 0.45)", strokeWidth: 1.5 };
  switch (a.style) {
    case "box":
      return <rect x={9} y={10} width={22} height={13} {...common} />;
    case "pixel":
      return <path d="M8 10h24v12H8z M11 22h4v4h-4z M25 22h4v4h-4z" {...common} />;
    case "kite":
      return <path d="M7 16 L20 8 L33 16 L20 24 Z" {...common} />;
    case "wing":
      return <path d="M6 15 L33 11 L31 20 L10 22 Z" {...common} />;
    case "prism":
      return <path d="M9 16 L14.5 8.5 L25.5 8.5 L31 16 L25.5 23.5 L14.5 23.5 Z" {...common} />;
    default:
      return <ellipse cx={20} cy={16} rx={12} ry={8} {...common} />;
  }
}

/** A small preview of a drone, trail or sky. */
function Swatch({ kind, id }: { kind: FlapItemKind; id: string }) {
  if (kind === "drone") {
    const a = findDrone(id).art;
    return (
      <svg className="flap-swatch drone" viewBox="0 0 40 28" aria-hidden="true">
        <rect x={19} y={4} width={2} height={5} fill="rgba(0, 0, 0, 0.45)" />
        <rect x={7} y={3} width={26} height={2.5} fill={a.rotor} />
        {droneShape(a)}
        <circle cx={26} cy={15} r={a.style === "beacon" ? 3.6 : 2.6} fill={a.light} />
      </svg>
    );
  }
  if (kind === "trail") {
    const a = findTrail(id).art;
    if (a.style === "none") return <span className="flap-swatch trail none">None</span>;
    return (
      <svg className="flap-swatch trail" viewBox="0 0 40 20" aria-hidden="true">
        {a.style === "comet" ? (
          <path d="M4 10 L34 6 L34 14 Z" fill={a.color} />
        ) : a.style === "waves" ? (
          [8, 16, 24].map((x, i) => <path key={x} d={`M${x + 6} 3 Q${x} 10 ${x + 6} 17`} fill="none" stroke={a.color} strokeWidth={2} opacity={1 - i * 0.25} />)
        ) : a.style === "bubbles" ? (
          [8, 18, 28].map((x, i) => <circle key={x} cx={x} cy={10 - i} r={2 + i} fill="none" stroke={a.color} strokeWidth={1.5} />)
        ) : (
          [6, 13, 20, 27, 34].map((x, i) => (
            <rect key={x} x={x - 1.5} y={a.style === "dots" ? 8 : 6 + ((i * 5) % 8)} width={a.style === "static" ? 5 : 3} height={a.style === "static" ? 1.5 : 3} fill={a.color} opacity={0.4 + i * 0.15} />
          ))
        )}
      </svg>
    );
  }
  const a = findSky(id).art;
  return (
    <span className="flap-swatch sky" style={{ background: `linear-gradient(${a.top}, ${a.bottom})` }}>
      <span className="flap-swatch-tower" style={{ background: a.tower }} />
      <span className="flap-swatch-light" style={{ background: a.accent }} />
      <span className="flap-swatch-ground" style={{ background: a.ground }} />
    </span>
  );
}

function Picker({
  legend,
  kind,
  value,
  collection,
  busy,
  onPick,
  onBuy,
}: {
  legend: string;
  kind: FlapItemKind;
  value: string;
  collection: FlapCollection | null;
  busy: boolean;
  onPick: (id: string) => void;
  onBuy: (id: string) => void;
}) {
  const items = LISTS[kind] as Item<unknown>[];
  const owned = (id: string) => listOf(collection, kind)?.find((i) => i.id === id)?.owned ?? items.find((i) => i.id === id)?.price === null;
  return (
    <fieldset className="wam-items">
      <legend>{legend}</legend>
      {items.map((it) => {
        const mine = owned(it.id);
        return (
          <button
            key={it.id}
            type="button"
            className={`wam-item${value === it.id ? " selected" : ""}${mine ? "" : " locked"}`}
            aria-pressed={value === it.id}
            disabled={busy}
            title={mine ? it.name : `${it.name}: buy for ${it.price} coins`}
            onClick={() => (mine ? onPick(it.id) : onBuy(it.id))}
          >
            <span className="wam-item-art">
              <Swatch kind={kind} id={it.id} />
            </span>
            <small>{it.name}</small>
            {!mine && <small className="wam-price">{it.price} coins</small>}
          </button>
        );
      })}
    </fieldset>
  );
}

/** Three little towers for each mode's card. */
function ModeTowers({ mode }: { mode: FlapMode }) {
  // Gap tops for three towers; each gap is 9 high in a 24-high box.
  const gaps = mode === "endless" ? [9, 4, 11] : [6, 10, 6];
  return (
    <svg className="flap-mode-towers" viewBox="0 0 36 24" aria-hidden="true">
      {gaps.map((g, i) => (
        <g key={i}>
          <rect x={3 + i * 12} y={0} width={6} height={g} />
          <rect x={3 + i * 12} y={g + 9} width={6} height={24 - g - 9} />
          <rect x={2 + i * 12} y={g - 1.5} width={8} height={1.5} className="cap" />
          <rect x={2 + i * 12} y={g + 9} width={8} height={1.5} className="cap" />
        </g>
      ))}
    </svg>
  );
}

function initialPrefs(): Prefs {
  const saved = loadPrefs(isItem);
  // ?daily=1 (from the Hub's "Today's Dailies") opens on the Daily.
  return wantsDaily() ? { ...saved, mode: "daily" } : saved;
}

export default function Play() {
  const [screen, setScreen] = useState<Screen>({ kind: "setup" });
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [collection, setCollection] = useState<FlapCollection | null>(null);
  const [buying, setBuying] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState<{ kind: FlapItemKind; id: string } | null>(null);
  /** Your Endless best as far as this visit knows (from the last result). */
  const [best, setBest] = useState(0);

  useEffect(() => {
    signalFlap
      .collection()
      .then(setCollection)
      .catch(() => setCollection(null));
  }, []);

  function update(patch: Partial<Prefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function buy(kind: FlapItemKind, id: string) {
    setBuying(true);
    setError(null);
    try {
      const c = await signalFlap.buy(kind, id);
      setCollection(c);
      playSfx("reward");
      void useWallet.getState().refresh();
      update({ [kind]: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBuying(false);
      setConfirmBuy(null);
    }
  }

  async function start(mode: FlapMode) {
    // Fall back to the free items if a saved choice isn't owned (any more).
    const own = (kind: FlapItemKind, id: string) => {
      const list = listOf(collection, kind);
      return !list || list.some((i) => i.id === id && i.owned) ? id : DEFAULT_PREFS[kind];
    };
    const look = { drone: own("drone", prefs.drone), trail: own("trail", prefs.trail), sky: own("sky", prefs.sky) };
    if (look.drone !== prefs.drone || look.trail !== prefs.trail || look.sky !== prefs.sky) update(look);
    setStarting(true);
    setError(null);
    try {
      const run = await signalFlap.start(mode, look);
      playSfx("click");
      setScreen({ kind: "round", run, game: new Game(run.seed), look });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start a run");
      setScreen({ kind: "setup" });
    } finally {
      setStarting(false);
    }
  }

  const finish = useCallback(async (runId: string, flaps: number[], quitAt: number | null) => {
    setScreen({ kind: "submitting" });
    try {
      const result = await signalFlap.finish(runId, flaps, quitAt);
      playSfx(result.new_best ? "reward" : "win");
      setScreen({ kind: "results", result });
      if (result.mode === "endless") setBest((b) => Math.max(b, result.previous_best, result.summary.score));
      useWallet.getState().celebrate(result.rewards);
      if (result.drop) {
        signalFlap
          .collection()
          .then(setCollection)
          .catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the server could not score this run");
      setScreen({ kind: "setup" });
    }
  }, []);

  const header = (
    <GameHeader
      gameId="signal-flap"
      tag={screen.kind === "round" ? <span className="tag">{MODE_INFO[screen.run.mode].name}</span> : undefined}
    />
  );

  if (screen.kind === "round") {
    const { run, game, look } = screen;
    return (
      <>
        {header}
        <Round
          key={run.run_id}
          game={game}
          look={look}
          daily={run.mode === "daily"}
          best={run.mode === "daily" ? 0 : best}
          onDone={(flaps, quitAt) => void finish(run.run_id, flaps, quitAt)}
        />
      </>
    );
  }
  if (screen.kind === "submitting") {
    return (
      <>
        {header}
        <div className="panel notice">
          <div className="loading">The server is replaying your flight</div>
        </div>
      </>
    );
  }
  if (screen.kind === "results") {
    const r = screen.result;
    const daily = r.mode === "daily";
    return (
      <>
        {header}
        <Results
          result={r}
          onAgain={daily ? null : () => void start(r.mode)}
          onMenu={() => setScreen({ kind: "setup" })}
          footer={
            daily ? (
              <ShareDaily
                gameId="signal-flap"
                headline={`${r.summary.score} pts`}
                detail={`${r.summary.gaps} gaps · ${r.summary.bars} signal bars`}
              />
            ) : undefined
          }
        />
      </>
    );
  }

  const sky = findSky(prefs.sky).art;
  return (
    <>
      {header}
      <div className="c4-menu">
        <div className="panel c4-panel flap-menu">
          <fieldset className="wam-modes flap-modes" style={{ "--flap-tower": sky.tower, "--flap-accent": sky.accent } as React.CSSProperties}>
            <legend>Mode</legend>
            {(Object.keys(MODE_INFO) as FlapMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`wam-mode${prefs.mode === m ? " selected" : ""}`}
                aria-pressed={prefs.mode === m}
                onClick={() => {
                  playSfx("click");
                  update({ mode: m });
                }}
              >
                <span className="wam-mode-icon" aria-hidden="true">
                  <ModeTowers mode={m} />
                </span>
                <strong>{MODE_INFO[m].name}</strong>
                <small>{MODE_INFO[m].blurb}</small>
              </button>
            ))}
          </fieldset>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <div className="game-controls">
            <button className="btn-green" onClick={() => void start(prefs.mode)} disabled={starting}>
              {starting ? "Starting…" : `▶ Play ${MODE_INFO[prefs.mode].name}`}
            </button>
          </div>

          {KINDS.map(({ kind, legend }) => (
            <Picker
              key={kind}
              legend={legend}
              kind={kind}
              value={prefs[kind]}
              collection={collection}
              busy={buying}
              onPick={(id) => update({ [kind]: id })}
              onBuy={(id) => setConfirmBuy({ kind, id })}
            />
          ))}
          {confirmBuy && (
            <div className="panel wam-confirm" role="alertdialog" aria-label="Confirm purchase">
              {(() => {
                const it = (LISTS[confirmBuy.kind] as Item<unknown>[]).find((i) => i.id === confirmBuy.id)!;
                return (
                  <>
                    <span>
                      Buy <strong>{it.name}</strong> for <strong>{it.price} coins</strong>?
                    </span>
                    <div className="game-controls">
                      <button className="btn-green btn-sm" disabled={buying} onClick={() => void buy(confirmBuy.kind, confirmBuy.id)}>
                        {buying ? "Buying…" : "Buy"}
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setConfirmBuy(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          <p className="wam-hint">Locked items can be bought with coins, or drop by luck after a run of 50 points or more.</p>

          <fieldset className="wam-legend flap-legend" style={{ "--flap-tower": sky.tower, "--flap-accent": sky.accent } as React.CSSProperties}>
            <legend>On the course</legend>
            <div>
              <span className="flap-legend-art" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x={9} y={0} width={6} height={8} className="tower" />
                  <rect x={9} y={16} width={6} height={8} className="tower" />
                </svg>
              </span>
              <small>Fly through the gap. Touching a tower, the ground or the top ends the run.</small>
            </div>
            <div>
              <span className="flap-legend-art" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x={5} y={14} width={3.5} height={5} className="accent" />
                  <rect x={10.25} y={10} width={3.5} height={9} className="accent" />
                  <rect x={15.5} y={6} width={3.5} height={13} className="accent" />
                </svg>
              </span>
              <small>Signal bar: 1 point. So is every gap you pass.</small>
            </div>
            <div>
              <span className="flap-legend-art" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x={9} y={0} width={6} height={6} className="tower" />
                  <rect x={7} y={6} width={10} height={3} className="accent" />
                  <rect x={7} y={15} width={10} height={3} className="accent" />
                  <rect x={9} y={18} width={6} height={6} className="tower" />
                </svg>
              </span>
              <small>Striped caps: this gap slides up and down.</small>
            </div>
          </fieldset>
          <p className="wam-hint">
            The drone hovers until your first flap. Gaps get narrower and the towers come faster the farther you fly.
          </p>
        </div>
      </div>
    </>
  );
}
