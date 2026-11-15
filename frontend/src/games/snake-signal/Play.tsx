import { useCallback, useEffect, useState } from "react";
import { snakeSignal } from "../../api/client";
import type { SnakeCollection, SnakeFinish, SnakeItemKind, SnakeMode, SnakeSize, SnakeStart } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { Game, type Dir } from "./engine";
import { ARENAS, SKINS, TRAILS, findArena, findSkin, findTrail } from "./items";
import { DEFAULT_PREFS, MODE_INFO, SIZE_INFO, loadPrefs, savePrefs, type Prefs } from "./modes";
import { POWER_ICON } from "./render";
import Results from "./Results";
import Round from "./Round";
import "./snake.css";

type Screen =
  | { kind: "setup" }
  | { kind: "round"; run: SnakeStart; game: Game; look: { skin: string; arena: string; trail: string } }
  | { kind: "submitting" }
  | { kind: "results"; result: SnakeFinish };

const LISTS = { skin: SKINS, arena: ARENAS, trail: TRAILS } as const;
const listOf = (c: SnakeCollection | null, kind: SnakeItemKind) =>
  kind === "skin" ? c?.skins : kind === "arena" ? c?.arenas : c?.trails;

const LEGEND: { icon: string; text: string }[] = [
  { icon: "◆", text: "Data packet: grow +1, refills signal" },
  { icon: "★", text: "Golden packet: 100 pts, grow +2" },
  { icon: POWER_ICON.boost, text: "Boost: ×2 points, can eat the bug" },
  { icon: POWER_ICON.phase, text: "Phase: slide through your tail" },
  { icon: POWER_ICON.magnet, text: "Magnet: pulls packets to you" },
  { icon: POWER_ICON.slow, text: "Slow-mo: everything slows down" },
  { icon: POWER_ICON.snip, text: "Snip: cuts your tail in half" },
  { icon: "▦", text: "Glitch block: flashes !, then solid" },
  { icon: "👾", text: "Glitch bug: deadly, unless Boosted" },
];

/** A small preview of a skin, arena or trail for the shop picker. */
function Swatch({ kind, id }: { kind: SnakeItemKind; id: string }) {
  if (kind === "skin") {
    const a = findSkin(id).art;
    const body =
      a.style === "rainbow"
        ? "linear-gradient(90deg, #ff5f7e, #ffd84d, #2ee88a, #3cc8f0, #b9b3ff)"
        : a.style === "stripes"
          ? `repeating-linear-gradient(90deg, ${a.body} 0 8px, ${a.stripe} 8px 11px)`
          : a.body;
    return (
      <span className={`snake-swatch skin ${a.style}`} style={{ background: body, boxShadow: `0 0 10px ${a.glow}` }}>
        <span style={{ background: a.head }} />
      </span>
    );
  }
  if (kind === "arena") {
    const a = findArena(id).art;
    return (
      <span className="snake-swatch arena" style={{ background: a.bg, borderColor: a.wall }}>
        <span style={{ color: a.food }}>◆</span>
      </span>
    );
  }
  const a = findTrail(id).art;
  return (
    <span className="snake-swatch trail" style={{ color: a.color }}>
      {a.style === "none" ? "—" : a.style === "bubbles" ? "∘ ○ ∘" : a.style === "stars" ? "✦ ✧ ✦" : a.style === "glitch" ? "▚ ▞ ▚" : a.style === "comet" ? "☄" : "· ✶ ·"}
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
  kind: SnakeItemKind;
  value: string;
  collection: SnakeCollection | null;
  busy: boolean;
  onPick: (id: string) => void;
  onBuy: (id: string) => void;
}) {
  const items = LISTS[kind];
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
            {!mine && <small className="wam-price">🔒 {it.price} 🪙</small>}
          </button>
        );
      })}
    </fieldset>
  );
}

const valid = (kind: SnakeItemKind, id: string) => LISTS[kind].some((i) => i.id === id);

function initialPrefs(): Prefs {
  const p = loadPrefs(valid);
  // First visit on a touch screen: show the D-pad.
  if (p === DEFAULT_PREFS && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    return { ...p, dpad: true };
  }
  return p;
}

export default function Play() {
  const [screen, setScreen] = useState<Screen>({ kind: "setup" });
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [collection, setCollection] = useState<SnakeCollection | null>(null);
  const [buying, setBuying] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState<{ kind: SnakeItemKind; id: string } | null>(null);

  useEffect(() => {
    snakeSignal
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

  async function buy(kind: SnakeItemKind, id: string) {
    setBuying(true);
    setError(null);
    try {
      const c = await snakeSignal.buy(kind, id);
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

  async function start() {
    // Fall back to the free items if a saved choice isn't owned (any more).
    const own = (kind: SnakeItemKind, id: string) => {
      const list = listOf(collection, kind);
      return !list || list.some((i) => i.id === id && i.owned) ? id : DEFAULT_PREFS[kind];
    };
    const look = { skin: own("skin", prefs.skin), arena: own("arena", prefs.arena), trail: own("trail", prefs.trail) };
    if (look.skin !== prefs.skin || look.arena !== prefs.arena || look.trail !== prefs.trail) update(look);
    setStarting(true);
    setError(null);
    try {
      const run = await snakeSignal.start(prefs.mode, prefs.size, look.skin, look.arena, look.trail);
      playSfx("click");
      setScreen({ kind: "round", run, game: new Game(run.seed, run.mode, run.size), look });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start a run");
      setScreen({ kind: "setup" });
    } finally {
      setStarting(false);
    }
  }

  const finish = useCallback(async (runId: string, turns: [number, Dir][], quitAt: number | null) => {
    setScreen({ kind: "submitting" });
    try {
      const result = await snakeSignal.finish(runId, turns, quitAt);
      playSfx(result.new_best ? "reward" : "win");
      setScreen({ kind: "results", result });
      useWallet.getState().celebrate(result.rewards);
      if (result.drop) {
        snakeSignal
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
      gameId="snake-signal"
      tag={
        screen.kind === "round" ? (
          <span className="tag">
            {MODE_INFO[screen.run.mode].name} · {SIZE_INFO[screen.run.size].name}
          </span>
        ) : undefined
      }
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
          skin={look.skin}
          arena={look.arena}
          trail={look.trail}
          dpad={prefs.dpad}
          onDone={(turns, quitAt) => void finish(run.run_id, turns, quitAt)}
        />
      </>
    );
  }
  if (screen.kind === "submitting") {
    return (
      <>
        {header}
        <div className="panel notice">
          <div className="loading">The server is replaying your run</div>
        </div>
      </>
    );
  }
  if (screen.kind === "results") {
    const daily = screen.result.mode === "daily";
    return (
      <>
        {header}
        <Results
          result={screen.result}
          onAgain={daily ? null : () => void start()}
          onMenu={() => setScreen({ kind: "setup" })}
        />
      </>
    );
  }

  const daily = prefs.mode === "daily";
  const size: SnakeSize = daily ? "medium" : prefs.size;
  return (
    <>
      {header}
      <div className="c4-menu">
        <div className="panel c4-panel">
          <fieldset className="wam-modes">
            <legend>Mode</legend>
            {(Object.keys(MODE_INFO) as SnakeMode[]).map((m) => (
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
                  {MODE_INFO[m].icon}
                </span>
                <strong>{MODE_INFO[m].name}</strong>
                <small>{MODE_INFO[m].blurb}</small>
              </button>
            ))}
          </fieldset>

          <div className="row-label">
            <span id="snake-size">
              Board size
              <small>{daily ? "The Daily is always the Medium board." : SIZE_INFO[size].note}</small>
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="snake-size">
              {(Object.keys(SIZE_INFO) as SnakeSize[]).map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={size === s}
                  disabled={daily}
                  className={`btn-sm${size === s ? "" : " btn-ghost"}`}
                  onClick={() => update({ size: s })}
                >
                  {SIZE_INFO[s].name}
                </button>
              ))}
            </div>
          </div>

          <label className="row-label">
            <span>
              On-screen D-pad
              <small>Big arrow buttons under the board. You can always swipe on the board too.</small>
            </span>
            <input type="checkbox" className="switch" checked={prefs.dpad} onChange={(e) => update({ dpad: e.target.checked })} />
          </label>

          <Picker
            legend="Snake skin"
            kind="skin"
            value={prefs.skin}
            collection={collection}
            busy={buying}
            onPick={(id) => update({ skin: id })}
            onBuy={(id) => setConfirmBuy({ kind: "skin", id })}
          />
          <Picker
            legend="Arena"
            kind="arena"
            value={prefs.arena}
            collection={collection}
            busy={buying}
            onPick={(id) => update({ arena: id })}
            onBuy={(id) => setConfirmBuy({ kind: "arena", id })}
          />
          <Picker
            legend="Trail"
            kind="trail"
            value={prefs.trail}
            collection={collection}
            busy={buying}
            onPick={(id) => update({ trail: id })}
            onBuy={(id) => setConfirmBuy({ kind: "trail", id })}
          />
          {confirmBuy && (
            <div className="panel wam-confirm" role="alertdialog" aria-label="Confirm purchase">
              {(() => {
                const it = LISTS[confirmBuy.kind].find((i) => i.id === confirmBuy.id)!;
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
          <p className="wam-hint">Locked items can be bought with coins, or drop by luck after a run of 5,000+ points.</p>

          <fieldset className="wam-legend snake-legend">
            <legend>What's on the board</legend>
            {LEGEND.map((l) => (
              <div key={l.text}>
                <span className="snake-legend-icon" aria-hidden="true">
                  {l.icon}
                </span>
                <small>{l.text}</small>
              </div>
            ))}
          </fieldset>
          <p className="wam-hint">
            Eat packets quickly one after another for a <strong>×2 → ×3 → ×5 combo</strong>. Turning away one step before a
            wall or your tail is a <strong>close call</strong> bonus. Your <strong>📶 signal</strong> fades over time: keep
            eating or the run ends.
          </p>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <div className="game-controls">
            <button className="btn-green" onClick={() => void start()} disabled={starting}>
              {starting ? "Starting…" : `▶ Play ${MODE_INFO[prefs.mode].name}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
