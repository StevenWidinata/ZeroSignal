import { useCallback, useEffect, useState } from "react";
import { echoRally } from "../../api/client";
import type { RallyCollection, RallyFinish, RallyItemKind, RallyLevel, RallyMode, RallyStart } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import type { Bot } from "./bot";
import { rules, type Game, type Input, type Power } from "./engine";
import {
  LISTS,
  POWER_ITEMS,
  findBall,
  findCourt,
  findPaddle,
  findPower,
  isItem,
  owns,
  type CosmeticKind,
  type Item,
} from "./items";
import { DEFAULT_PREFS, LEVELS, LEVEL_INFO, MODE_INFO, TARGETS, loadPrefs, savePrefs, toggleKit, type Prefs } from "./modes";
import PowerIcon from "./PowerIcon";
import { startMatch } from "./replay";
import Results from "./Results";
import Round, { type RoundLook } from "./Round";
import "./rally.css";

type Screen =
  | { kind: "setup" }
  | { kind: "round"; match: RallyStart; game: Game; bot: Bot; look: RoundLook }
  | { kind: "submitting" }
  | { kind: "results"; result: RallyFinish; level: RallyLevel };

const KINDS: { kind: CosmeticKind; legend: string }[] = [
  { kind: "paddle", legend: "Paddle" },
  { kind: "ball", legend: "Ball" },
  { kind: "court", legend: "Court" },
];

/** Coins for a win at each level (the server pays these). */
const WIN_COINS: Record<RallyLevel, number> = { easy: 8, medium: 20, hard: 40, master: 90 };

/** A small preview of a paddle, ball or court. */
function Swatch({ kind, id }: { kind: CosmeticKind; id: string }) {
  if (kind === "paddle") {
    const a = findPaddle(id).art;
    return (
      <svg className="rally-swatch" viewBox="0 0 40 28" aria-hidden="true">
        <rect x={16} y={3} width={8} height={22} fill={a.style === "laser" ? a.color : a.color} stroke={a.style === "laser" ? a.edge : "none"} strokeWidth={1.5} />
        {(a.style === "neon" || a.style === "gold" || a.style === "chrome") && <rect x={18.5} y={5} width={2} height={18} fill={a.edge} />}
        {a.style === "crystal" && <path d="M16 6l8 6M16 14l8 6" stroke={a.edge} strokeWidth={1} />}
      </svg>
    );
  }
  if (kind === "ball") {
    const a = findBall(id).art;
    return (
      <svg className="rally-swatch" viewBox="0 0 40 28" aria-hidden="true">
        {(a.style === "fire" || a.style === "comet") && <path d="M6 14 L22 10 L22 18 Z" fill={a.glow} opacity={0.6} />}
        {a.style === "square" ? <rect x={18} y={8} width={12} height={12} fill={a.color} /> : <circle cx={24} cy={14} r={6} fill={a.color} />}
        {a.style === "bat" && <path d="M19 11l1.5-5 3 3.5M29 11l-1.5-5-3 3.5" fill={a.color} />}
        {a.style === "plasma" && <circle cx={24} cy={14} r={2.6} fill={a.glow} />}
        {a.style === "rings" && <circle cx={24} cy={14} r={10} fill="none" stroke={a.glow} strokeWidth={1} />}
      </svg>
    );
  }
  const a = findCourt(id).art;
  return (
    <svg className="rally-swatch court" viewBox="0 0 40 28" aria-hidden="true">
      <rect width={40} height={28} fill={a.bg} />
      {a.style === "grid" && <path d="M10 0v28M20 0v28M30 0v28M0 9h40M0 19h40" stroke={a.line} strokeWidth={0.75} />}
      {a.style === "scan" && <path d="M0 4h40M0 9h40M0 14h40M0 19h40M0 24h40" stroke={a.line} strokeWidth={1} />}
      {a.style === "synth" && <path d="M20 14L0 28M20 14L40 28M20 14L10 28M20 14L30 28M0 20h40M0 24h40" stroke={a.line} strokeWidth={0.75} />}
      {a.style === "cabinet" && <rect x={1.5} y={1.5} width={37} height={25} fill="none" stroke={a.accent} strokeWidth={1} />}
      {a.style === "stadium" && <rect x={4} y={4} width={32} height={20} fill="none" stroke={a.net} strokeWidth={0.75} opacity={0.5} />}
      {a.style === "space" && <path d="M6 5h1M31 8h1M12 21h1M27 23h1M35 17h1" stroke={a.accent} strokeWidth={1} />}
      <path d="M20 2v4M20 10v4M20 18v4M20 26v2" stroke={a.net} strokeWidth={1.5} />
      <rect x={4} y={10} width={2} height={8} fill={a.accent} />
      <rect x={34} y={8} width={2} height={8} fill={a.net} />
    </svg>
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
  kind: CosmeticKind;
  value: string;
  collection: RallyCollection | null;
  busy: boolean;
  onPick: (id: string) => void;
  onBuy: (id: string) => void;
}) {
  const items = LISTS[kind] as Item<unknown>[];
  return (
    <fieldset className="wam-items">
      <legend>{legend}</legend>
      {items.map((it) => {
        const mine = owns(collection, kind, it.id);
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

/** Pick the 3 powers you bring into a Chaos match. */
function KitPicker({
  kit,
  collection,
  coins,
  busy,
  onKit,
  onBuy,
}: {
  kit: Power[];
  collection: RallyCollection | null;
  coins: number;
  busy: boolean;
  onKit: (kit: Power[]) => void;
  onBuy: (id: Power) => void;
}) {
  const [focus, setFocus] = useState<Power>(kit[0] ?? "grow");
  const detail = findPower(focus);
  const have = (p: Power) => owns(collection, "power", p);
  return (
    <fieldset className="rally-kitpick">
      <legend>
        Your powers <small>({kit.length} of {rules.kit_size})</small>
      </legend>
      <div className="rally-kitgrid">
        {POWER_ITEMS.map((p) => {
          const mine = have(p.id);
          const on = kit.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`rally-kittile${on ? " selected" : ""}${mine ? "" : " locked"}`}
              aria-pressed={on}
              onClick={() => {
                setFocus(p.id);
                if (mine) onKit(toggleKit(kit, p.id));
              }}
            >
              <PowerIcon power={p.id} />
              <strong>{p.name}</strong>
              <small>{on ? `Slot ${kit.indexOf(p.id) + 1}` : mine ? (p.price === null ? "Free" : "Owned") : `${p.price} coins`}</small>
            </button>
          );
        })}
      </div>
      <p className="rally-kitdetail" aria-live="polite">
        <strong>{detail.name}.</strong> {detail.text}
        {!have(detail.id) && detail.price !== null && (
          <button className="btn-green btn-sm" onClick={() => onBuy(detail.id)} disabled={busy || coins < detail.price}>
            Buy for {detail.price.toLocaleString()} coins
          </button>
        )}
      </p>
    </fieldset>
  );
}

/** Two paddles and a ball, or a ball with sparks around it, for each mode's card. */
function ModeArt({ mode }: { mode: RallyMode }) {
  return (
    <svg className="rally-mode-art" viewBox="0 0 42 28" aria-hidden="true">
      <rect x={3} y={6} width={3} height={12} />
      <rect x={36} y={11} width={3} height={12} />
      <rect x={19} y={13} width={4} height={4} className="ball" />
      {mode === "chaos" && <path d="M27 6l2-3M31 9l3-1M14 22l-2 3M10 19l-3 1" className="spark" />}
    </svg>
  );
}

export default function Play() {
  const [screen, setScreen] = useState<Screen>({ kind: "setup" });
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs(isItem);
    // First visit on a touch screen: show the phone buttons.
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    return localStorage.getItem("zerosignal_rally_prefs") === null && coarse ? { ...p, buttons: true } : p;
  });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [collection, setCollection] = useState<RallyCollection | null>(null);
  const [buying, setBuying] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState<{ kind: RallyItemKind; id: string } | null>(null);
  const coins = useWallet((s) => s.wallet?.coins ?? 0);

  useEffect(() => {
    echoRally
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

  async function buy(kind: RallyItemKind, id: string) {
    setBuying(true);
    setError(null);
    try {
      const c = await echoRally.buy(kind, id);
      setCollection(c);
      playSfx("reward");
      void useWallet.getState().refresh();
      if (kind === "power") {
        if (!prefs.kit.includes(id as Power)) update({ kit: toggleKit(prefs.kit, id as Power) });
      } else {
        update({ [kind]: id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBuying(false);
      setConfirmBuy(null);
    }
  }

  async function start() {
    // Fall back to free items if a saved choice isn't owned (any more).
    const own = (kind: CosmeticKind, id: string) => (owns(collection, kind, id) ? id : DEFAULT_PREFS[kind]);
    const look = { paddle: own("paddle", prefs.paddle), ball: own("ball", prefs.ball), court: own("court", prefs.court) };
    if (look.paddle !== prefs.paddle || look.ball !== prefs.ball || look.court !== prefs.court) update(look);
    const chaos = prefs.mode === "chaos";
    let kit = prefs.kit.filter((p) => owns(collection, "power", p));
    if (chaos && kit.length !== rules.kit_size) {
      setError(`Pick ${rules.kit_size} powers you own first.`);
      return;
    }
    if (!chaos) kit = [];
    setStarting(true);
    setError(null);
    try {
      const match = await echoRally.start({ target: prefs.target, level: prefs.level, mode: prefs.mode, kit }, look);
      const { game, bot } = startMatch({
        seed: match.seed,
        target: match.target,
        level: LEVELS.indexOf(match.level),
        chaos: match.chaos,
        kit: match.kit as Power[],
      });
      playSfx("click");
      setScreen({ kind: "round", match, game, bot, look });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start a match");
      setScreen({ kind: "setup" });
    } finally {
      setStarting(false);
    }
  }

  const finish = useCallback(async (match: RallyStart, inputs: Input[], quitAt: number | null) => {
    setScreen({ kind: "submitting" });
    try {
      const result = await echoRally.finish(match.match_id, inputs, quitAt);
      playSfx(result.won ? "win" : "lose");
      setScreen({ kind: "results", result, level: match.level });
      useWallet.getState().celebrate(result.rewards);
      if (result.drop) {
        echoRally
          .collection()
          .then(setCollection)
          .catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the server could not check this match");
      setScreen({ kind: "setup" });
    }
  }, []);

  const header = (
    <GameHeader
      gameId="echo-rally"
      tag={
        screen.kind === "round" ? (
          <span className="tag">
            {screen.match.chaos ? "Chaos" : "Classic"} · first to {screen.match.target}
          </span>
        ) : undefined
      }
    />
  );

  if (screen.kind === "round") {
    const { match, game, bot, look } = screen;
    return (
      <>
        {header}
        <Round
          key={match.match_id}
          game={game}
          bot={bot}
          look={look}
          rival={LEVEL_INFO[match.level].name}
          buttons={prefs.buttons}
          onDone={(inputs, quitAt) => void finish(match, inputs, quitAt)}
        />
      </>
    );
  }
  if (screen.kind === "submitting") {
    return (
      <>
        {header}
        <div className="panel notice">
          <div className="loading">The server is replaying your match</div>
        </div>
      </>
    );
  }
  if (screen.kind === "results") {
    return (
      <>
        {header}
        <Results result={screen.result} level={screen.level} onAgain={() => void start()} onMenu={() => setScreen({ kind: "setup" })} />
      </>
    );
  }

  const confirmItem = confirmBuy
    ? confirmBuy.kind === "power"
      ? findPower(confirmBuy.id)
      : (LISTS[confirmBuy.kind] as Item<unknown>[]).find((i) => i.id === confirmBuy.id)!
    : null;

  const confirmPanel = confirmBuy && confirmItem && (
            <div className="panel wam-confirm" role="alertdialog" aria-label="Confirm purchase">
              <span>
                Buy <strong>{confirmItem.name}</strong> for <strong>{confirmItem.price} coins</strong>?
              </span>
              <div className="game-controls">
                <button className="btn-green btn-sm" disabled={buying} onClick={() => void buy(confirmBuy.kind, confirmBuy.id)}>
                  {buying ? "Buying…" : "Buy"}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmBuy(null)}>
                  Cancel
                </button>
              </div>
            </div>
  );

  return (
    <>
      {header}
      <div className="c4-menu">
        <div className="panel c4-panel rally-menu">
          <fieldset className="wam-modes rally-modes">
            <legend>Mode</legend>
            {(Object.keys(MODE_INFO) as RallyMode[]).map((m) => (
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
                  <ModeArt mode={m} />
                </span>
                <strong>{MODE_INFO[m].name}</strong>
                <small>{MODE_INFO[m].blurb}</small>
              </button>
            ))}
          </fieldset>

          <fieldset className="c4-diffs rally-levels">
            <legend>Zero-Bot level</legend>
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`c4-diff diff-${l === "master" ? "impossible" : l}${prefs.level === l ? " selected" : ""}`}
                aria-pressed={prefs.level === l}
                onClick={() => update({ level: l })}
              >
                <strong>{LEVEL_INFO[l].name}</strong>
                <small>{LEVEL_INFO[l].blurb}</small>
                <small>Win: {WIN_COINS[l]} coins</small>
              </button>
            ))}
          </fieldset>

          <div className="row-label">
            <span id="rally-target">
              Points to win
              <small>A win adds level × points to your board total.</small>
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="rally-target">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={prefs.target === t}
                  className={`btn-sm${prefs.target === t ? "" : " btn-ghost"}`}
                  onClick={() => update({ target: t })}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {prefs.mode === "chaos" && (
            <KitPicker
              kit={prefs.kit.filter((p) => owns(collection, "power", p))}
              collection={collection}
              coins={coins}
              busy={buying}
              onKit={(kit) => update({ kit })}
              onBuy={(id) => setConfirmBuy({ kind: "power", id })}
            />
          )}
          {confirmBuy?.kind === "power" && confirmPanel}

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
          {confirmBuy?.kind !== "power" && confirmPanel}

          <label className="row-label">
            <span>
              Phone buttons
              <small>Up and down buttons under the court. You can also drag on the court.</small>
            </span>
            <input type="checkbox" className="switch" checked={prefs.buttons} onChange={(e) => update({ buttons: e.target.checked })} />
          </label>

          <p className="wam-hint">
            Locked items can be bought with coins. Wins against Hard or Master can also drop a paddle, ball or court you don't have
            yet. The server replays every match.
          </p>
        </div>
      </div>
    </>
  );
}

