import { useEffect, useRef, useState } from "react";
import { sonar } from "../../api/client";
import type { SonarGame, SonarLevel, SonarResult } from "../../api/types";
import { MyReaction, VersusBar, ZERO_BOT } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx, type Sfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Battle from "./Battle";
import { describe, fxFor, type Fx } from "./fleet";
import { itemName } from "./items";

export const LEVEL_LABEL: Record<SonarLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard", master: "Master" };

export const SOUND: Record<SonarResult["kind"], Sfx> = {
  miss: "splash",
  hit: "boom",
  sunk: "clang",
  ping: "chime",
  radar: "chime",
  seen: "zap",
  clear: "splash",
  dud: "whiff",
  mine: "boom",
  mine_seen: "zap",
  crate: "reward",
  crate_seen: "zap",
  blocked: "clank",
  exposed: "bonk",
  repaired: "reward",
  charged: "fever",
};

export default function AiGame({ initial, onExit, onRematch }: { initial: SonarGame; onExit: () => void; onRematch: () => void }) {
  const [game, setGame] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [fx, setFx] = useState<{ key: number; list: Fx[] } | null>(null);
  const [fxYours, setFxYours] = useState<{ key: number; list: Fx[] } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const active = game.status === "active";
  const mine = game.log.filter((e) => e.mine);
  const theirs = game.log.filter((e) => !e.mine);
  const lastMine = mine[mine.length - 1];
  const lastTheirs = theirs[theirs.length - 1];
  const showCell = (e: typeof lastMine | undefined) => (e && !e.ping && e.hits.length === 1 ? e.hits[0].cell : null);

  /** A shot or ping, or (Tactics) any move code. */
  async function send(move: { cell: number; ping: boolean } | { code: string }) {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    playSfx("cell" in move && move.ping ? "zap" : "click");
    try {
      const g = "code" in move ? await sonar.move(game.id, move.code) : await sonar.fire(game.id, move.cell, move.ping);
      if (!mounted.current) return;
      const fresh = g.log.slice(game.log.length);
      const yours = fresh.filter((e) => e.mine);
      const bots = fresh.filter((e) => !e.mine);
      // Show your result first, then Zero-Bot's answers a moment later.
      setGame({ ...g, log: bots.length ? g.log.slice(0, g.log.length - bots.length) : g.log, your_sea: bots.length ? game.your_sea : g.your_sea, status: bots.length ? "active" : g.status });
      const you = yours[yours.length - 1];
      if (you) {
        playSfx(SOUND[you.result.kind]);
        setNews(describe(you, "You", "their"));
        setFx({ key: Date.now(), list: fxFor(you) });
      }
      for (const bot of bots) {
        await new Promise((r) => window.setTimeout(r, 650));
        if (!mounted.current) return;
        playSfx(SOUND[bot.result.kind]);
        setFxYours({ key: Date.now(), list: fxFor(bot) });
        setNews((s) => `${s ?? ""} · ${describe(bot, "Zero-Bot", "your")}`);
      }
      if (!bots.length && g.your_turn && g.status === "active") setNews((s) => `${s ?? ""} · Your turn again!`);
      setGame(g);
      if (g.status !== "active") {
        playSfx(g.status === "won" ? "win" : "lose");
        useWallet.getState().celebrate(g.rewards);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "that didn't work");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function resign() {
    setBusy(true);
    try {
      const g = await sonar.resign(game.id);
      setGame(g);
      playSfx("lose");
      useWallet.getState().celebrate(g.rewards);
    } catch (e) {
      setError(e instanceof Error ? e.message : "that didn't work");
    } finally {
      setBusy(false);
      setConfirmResign(false);
    }
  }

  const result = game.status === "won" ? "win" : game.status === "active" ? null : "loss";
  let status: string;
  if (game.status === "won") status = `🏆 You sank Zero-Bot's whole fleet on ${LEVEL_LABEL[game.level]}${game.mode === "tactics" ? " in Tactics" : ""}!`;
  else if (game.status === "lost") status = "💥 Zero-Bot sank your fleet. Try again!";
  else if (game.status === "resigned") status = "🏳 You gave up this battle.";
  else if (busy) status = news ?? "Zero-Bot is aiming…";
  else if (news) status = news.endsWith("Your turn again!") ? news : `${news} · Your turn`;
  else status = game.mode === "tactics" ? "Your turn: fire, ping, or pick a ship power below." : "Your turn: pick a square on Zero-Bot's sea.";

  return (
    <div className="c4-play sonar-play">
      <VersusBar opponent={ZERO_BOT} opponentName={`Zero-Bot · ${LEVEL_LABEL[game.level]}`} turn={!active ? null : busy ? "them" : "me"} result={result} />
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <Battle
        target={game.target}
        yourSea={game.your_sea}
        yourFleet={game.fleet}
        fleetSkin={game.fleet_skin}
        sea={game.sea}
        canFire={active && !busy && game.your_turn}
        onFire={(cell, ping) => void send({ cell, ping })}
        onMove={(code) => void send({ code })}
        powers={active ? game.powers : null}
        theirPowers={game.bot_powers}
        fx={fx}
        fxYours={fxYours}
        theirFleet={game.ai_fleet}
        targetLabel="Zero-Bot's sea"
        yourLabel="Your fleet"
        lastTarget={showCell(lastMine)}
        lastYours={showCell(lastTheirs)}
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!active && (
        <div className="panel wam-results">
          <MyReaction pose={game.status === "won" ? "cheer" : "sad"} />
          <h3>{status}</h3>
          <div className="wam-stats">
            <span>
              <strong>{game.target.shots}</strong> your moves
            </span>
            <span>
              <strong>{game.your_sea.sunk.length}</strong> ships lost
            </span>
            {game.points !== null && game.points > 0 && (
              <span>
                <strong>+{game.points}</strong> points
              </span>
            )}
          </div>
          {game.drop && <p className="unlock">🍀 Lucky drop: you won {itemName(game.drop)}!</p>}
          <p className="hint">Zero-Bot's hidden ships are shown faintly on its sea.</p>
        </div>
      )}
      <div className="game-controls">
        {active &&
          (confirmResign ? (
            <span className="g2048-confirm">
              Give up this battle?
              <button className="btn-danger btn-sm" onClick={() => void resign()}>
                Yes, give up
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmResign(false)}>
                Keep playing
              </button>
            </span>
          ) : (
            <button className="btn-ghost" disabled={busy} onClick={() => setConfirmResign(true)}>
              🏳 Give up
            </button>
          ))}
        {!active && (
          <button className="btn-green" onClick={onRematch}>
            ↻ Play again
          </button>
        )}
        <button className="btn-ghost" onClick={onExit} disabled={busy}>
          ← Menu
        </button>
      </div>
      {!active && <SaveScorePrompt />}
      {active && <p className="hint">The server keeps both fleets secret and checks every shot. Sink all 5 of Zero-Bot's ships to win.</p>}
    </div>
  );
}
