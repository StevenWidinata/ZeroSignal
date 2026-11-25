import { useCallback, useEffect, useState } from "react";
import { brickBreaker } from "../../api/client";
import type { BrickCollection, BrickFinish, BrickItemKind, BrickMode, BrickProgress, BrickStart } from "../../api/types";
import ShareDaily from "../../components/dailies/ShareDaily";
import { wantsDaily } from "../../components/dailies/logic";
import GameHeader from "../../components/GameHeader";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { DROPS, Game, type Input } from "./engine";
import { LISTS, findBackdrop, findBall, findPaddle, findTheme, isItem, type Item } from "./items";
import LevelSelect from "./LevelSelect";
import { LEVELS, levelById } from "./levels";
import { DEFAULT_PREFS, DROP_INFO, MODE_INFO, loadPrefs, savePrefs, type Prefs } from "./modes";
import Results from "./Results";
import Round, { type RoundLook } from "./Round";
import "./brick.css";

type Screen =
  | { kind: "setup" }
  | { kind: "round"; run: BrickStart; game: Game; look: RoundLook }
  | { kind: "submitting" }
  | { kind: "results"; result: BrickFinish };

const KINDS: { kind: BrickItemKind; legend: string }[] = [
  { kind: "paddle", legend: "Paddle" },
  { kind: "ball", legend: "Ball" },
  { kind: "theme", legend: "Brick theme" },
  { kind: "backdrop", legend: "Backdrop" },
];

const listOf = (c: BrickCollection | null, kind: BrickItemKind) =>
  kind === "paddle" ? c?.paddles : kind === "ball" ? c?.balls : kind === "theme" ? c?.themes : c?.backdrops;

/** A small preview of a paddle, ball, brick theme or backdrop. */
function Swatch({ kind, id }: { kind: BrickItemKind; id: string }) {
  if (kind === "paddle") {
    const a = findPaddle(id).art;
    return (
      <span
        className={`brick-swatch paddle ${a.style}`}
        style={{ background: a.color, borderColor: a.style === "neon" ? a.edge : "transparent", boxShadow: `inset 0 3px 0 ${a.edge}` }}
      />
    );
  }
  if (kind === "ball") {
    const a = findBall(id).art;
    return <span className={`brick-swatch ball ${a.style}`} style={{ background: a.color, borderColor: a.edge }} />;
  }
  if (kind === "theme") {
    const a = findTheme(id).art;
    return (
      <span className={`brick-swatch theme ${a.style}`}>
        {[a.rows[0], a.rows[2], a.rows[4], a.tough, a.steel, a.explosive].map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </span>
    );
  }
  const a = findBackdrop(id).art;
  return (
    <span className="brick-swatch backdrop" style={{ background: a.bg, borderColor: a.wall }}>
      <span style={{ background: a.line }} />
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
  kind: BrickItemKind;
  value: string;
  collection: BrickCollection | null;
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

/** A tiny wall standing for each mode on its card. */
function ModeWall({ mode }: { mode: BrickMode }) {
  const rows = mode === "campaign" ? ["..nn..", ".nnnn.", "nnnnnn"] : mode === "endless" ? ["nnnnnn", "nnnnnn", "nnnnnn"] : ["nn..nn", "nnnnnn", "..nn.."];
  return (
    <svg className="brick-mode-wall" viewBox="0 0 24 9" aria-hidden="true">
      {rows.flatMap((row, r) =>
        [...row].map((ch, c) =>
          ch === "n" ? <rect key={`${r}-${c}`} x={c * 4 + 0.3} y={r * 3 + 0.3} width={3.4} height={2.4} rx={0.5} className={`r${r}`} /> : null,
        ),
      )}
    </svg>
  );
}

function initialPrefs(): Prefs {
  const saved = loadPrefs(isItem);
  // ?daily=1 (from the Hub's "Today's Dailies") opens on the Daily.
  const p = wantsDaily() ? { ...saved, mode: "daily" as const } : saved;
  // First visit on a touch screen: show the phone buttons.
  if (p === DEFAULT_PREFS && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    return { ...p, buttons: true };
  }
  return p;
}

export default function Play() {
  const [screen, setScreen] = useState<Screen>({ kind: "setup" });
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [collection, setCollection] = useState<BrickCollection | null>(null);
  const [progress, setProgress] = useState<BrickProgress | null>(null);
  const [buying, setBuying] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState<{ kind: BrickItemKind; id: string } | null>(null);

  const loadProgress = useCallback(() => {
    brickBreaker
      .levels()
      .then(setProgress)
      .catch((e) => setError(e instanceof Error ? e.message : "could not load your levels"));
  }, []);

  useEffect(() => {
    brickBreaker
      .collection()
      .then(setCollection)
      .catch(() => setCollection(null));
    loadProgress();
  }, [loadProgress]);

  function update(patch: Partial<Prefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function buy(kind: BrickItemKind, id: string) {
    setBuying(true);
    setError(null);
    try {
      const c = await brickBreaker.buy(kind, id);
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

  async function start(mode: BrickMode, levelId: number | null) {
    // Fall back to the free items if a saved choice isn't owned (any more).
    const own = (kind: BrickItemKind, id: string) => {
      const list = listOf(collection, kind);
      return !list || list.some((i) => i.id === id && i.owned) ? id : DEFAULT_PREFS[kind];
    };
    const look = {
      paddle: own("paddle", prefs.paddle),
      ball: own("ball", prefs.ball),
      theme: own("theme", prefs.theme),
      backdrop: own("backdrop", prefs.backdrop),
    };
    if (look.paddle !== prefs.paddle || look.ball !== prefs.ball || look.theme !== prefs.theme || look.backdrop !== prefs.backdrop) update(look);
    setStarting(true);
    setError(null);
    try {
      const run = await brickBreaker.start(mode, levelId, look);
      const layout = run.level !== null ? levelById(run.level) : null;
      playSfx("click");
      setScreen({ kind: "round", run, game: new Game(run.seed, layout), look });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start a run");
      setScreen({ kind: "setup" });
    } finally {
      setStarting(false);
    }
  }

  const finish = useCallback(
    async (runId: string, inputs: Input[], quitAt: number | null) => {
      setScreen({ kind: "submitting" });
      try {
        const result = await brickBreaker.finish(runId, inputs, quitAt);
        playSfx(result.summary.cleared || result.new_best ? "reward" : "win");
        setScreen({ kind: "results", result });
        useWallet.getState().celebrate(result.rewards);
        if (result.campaign) loadProgress();
        if (result.drop) {
          brickBreaker
            .collection()
            .then(setCollection)
            .catch(() => undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "the server could not score this run");
        setScreen({ kind: "setup" });
      }
    },
    [loadProgress],
  );

  const levelTag = (id: number | null) => {
    const l = id !== null ? LEVELS.find((x) => x.level.id === id)?.level : undefined;
    return l ? `Level ${l.id}: ${l.name}` : null;
  };

  const header = (
    <GameHeader
      gameId="brick-breaker"
      tag={
        screen.kind === "round" ? (
          <span className="tag">{levelTag(screen.run.level) ?? MODE_INFO[screen.run.mode].name}</span>
        ) : undefined
      }
    />
  );

  if (screen.kind === "round") {
    const { run, game, look } = screen;
    const l = run.level !== null ? LEVELS.find((x) => x.level.id === run.level)?.level : undefined;
    return (
      <>
        {header}
        <Round
          key={run.run_id}
          game={game}
          level={l ? { id: l.id, name: l.name } : null}
          look={look}
          buttons={prefs.buttons}
          daily={run.mode === "daily"}
          onDone={(inputs, quitAt) => void finish(run.run_id, inputs, quitAt)}
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
    const r = screen.result;
    const daily = r.mode === "daily";
    const nextId = r.level !== null && r.summary.cleared && r.level < LEVELS.length ? r.level + 1 : null;
    return (
      <>
        {header}
        <Results
          result={r}
          onAgain={daily ? null : () => void start(r.mode, r.level)}
          onNext={nextId !== null ? () => void start("campaign", nextId) : null}
          onMenu={() => setScreen({ kind: "setup" })}
          footer={
            daily ? (
              <ShareDaily
                gameId="brick-breaker"
                headline={`${r.summary.score.toLocaleString()} pts`}
                detail={`Wave ${r.summary.wave} · ${r.summary.bricks} bricks · best combo ${r.summary.best_combo}`}
              />
            ) : undefined
          }
        />
      </>
    );
  }

  const campaign = prefs.mode === "campaign";
  const upTo = progress?.unlocked_up_to ?? 1;
  const nextLevel = LEVELS.find((l) => l.level.id === upTo)?.level;
  const theme = findTheme(prefs.theme).art;
  return (
    <>
      {header}
      <div className="c4-menu">
        <div className="panel c4-panel brick-menu">
          <fieldset className="wam-modes brick-modes" style={{ "--brick-a": theme.rows[0], "--brick-b": theme.rows[2], "--brick-c": theme.rows[4] } as React.CSSProperties}>
            <legend>Mode</legend>
            {(Object.keys(MODE_INFO) as BrickMode[]).map((m) => (
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
                  <ModeWall mode={m} />
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
            {campaign ? (
              <button className="btn-green" disabled={starting || !progress || !nextLevel} onClick={() => nextLevel && void start("campaign", nextLevel.id)}>
                {starting ? "Starting…" : nextLevel ? `▶ Play level ${nextLevel.id}: ${nextLevel.name}` : "▶ Play"}
              </button>
            ) : (
              <button className="btn-green" onClick={() => void start(prefs.mode, null)} disabled={starting}>
                {starting ? "Starting…" : `▶ Play ${MODE_INFO[prefs.mode].name}`}
              </button>
            )}
          </div>

          {campaign && <LevelSelect progress={progress} theme={theme} busy={starting} onPlay={(id) => void start("campaign", id)} />}

          <label className="row-label">
            <span>
              Phone buttons
              <small>Hold-down ◀ ▶ and a Launch button under the board. You can always drag on the board too.</small>
            </span>
            <input type="checkbox" className="switch" checked={prefs.buttons} onChange={(e) => update({ buttons: e.target.checked })} />
          </label>

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
          <p className="wam-hint">
            Locked items can be bought with coins, or drop by luck after a 3-star clear or an Endless or Daily run of 10,000+
            points.
          </p>

          <fieldset className="wam-legend brick-legend">
            <legend>Bricks</legend>
            {(
              [
                ["n", theme.rows[0], "Normal: one hit"],
                ["t", theme.tough, "Tough: 2 or 3 hits, cracks show what's left"],
                ["s", theme.steel, "Steel: can't break, bounce around it"],
                ["e", theme.explosive, "Explosive: breaks the bricks around it"],
              ] as const
            ).map(([k, color, text]) => (
              <div key={k}>
                <span className={`brick-legend-brick k-${k}`} style={{ background: color }} aria-hidden="true" />
                <small>{text}</small>
              </div>
            ))}
            <div>
              <span className="brick-legend-brick k-m" style={{ background: theme.rows[3] }} aria-hidden="true" />
              <small>Moving: slides from side to side</small>
            </div>
          </fieldset>
          <fieldset className="wam-legend brick-legend">
            <legend>Drops</legend>
            {DROPS.map((d) => (
              <div key={d}>
                <span className="brick-capsule" style={{ background: DROP_INFO[d].color }} aria-hidden="true">
                  {DROP_INFO[d].letter}
                </span>
                <small>
                  <strong>{DROP_INFO[d].name}</strong>: {DROP_INFO[d].text}
                </small>
              </div>
            ))}
          </fieldset>
          <p className="wam-hint">
            Bricks with a small colored dot hold a drop. Break bricks without the ball touching the paddle in between to build a
            combo: 4 in a row for ×2 points, 8 for ×3, 12 for ×4. The ball speeds up a little as you go.
          </p>
        </div>
      </div>
    </>
  );
}
