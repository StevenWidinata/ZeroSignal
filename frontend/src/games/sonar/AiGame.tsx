import { useEffect, useRef, useState } from "react";
import { sonar } from "../../api/client";
import type { SonarGame, SonarLevel, SonarResult } from "../../api/types";
import { MyReaction, VersusBar, ZERO_BOT } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx, type Sfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Battle from "./Battle";
import { label, resultText } from "./fleet";
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

  async function fire(cell: number, ping: boolean) {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    playSfx(ping ? "zap" : "click");
    try {
      const g = await sonar.fire(game.id, cell, ping);
      if (!mounted.current) return;
      const n = g.log.length;
      const you = g.log.filter((e) => e.mine).slice(-1)[0];
      const bot = g.log[n - 1] && !g.log[n - 1].mine ? g.log[n - 1] : null;
      // Show your result first, then Zero-Bot's answer a moment later.
      setGame({ ...g, log: bot ? g.log.slice(0, -1) : g.log, your_sea: bot ? game.your_sea : g.your_sea, status: bot ? "active" : g.status });
      if (you) {
        playSfx(SOUND[you.result.kind]);
        setNews(`You ${you.ping ? "pinged" : "fired at"} ${label(you.cell)}: ${resultText(you.result)}`);
      }
      if (bot) {
        await new Promise((r) => window.setTimeout(r, 650));
        if (!mounted.current) return;
        playSfx(SOUND[bot.result.kind]);
        setNews((s) => `${s ?? ""} · Zero-Bot ${bot.ping ? "pinged" : "fired at"} ${label(bot.cell)}: ${resultText(bot.result, "your")}`);
      }
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
  if (game.status === "won") status = `🏆 You sank Zero-Bot's whole fleet on ${LEVEL_LABEL[game.level]}!`;
  else if (game.status === "lost") status = "💥 Zero-Bot sank your fleet. Try again!";
  else if (game.status === "resigned") status = "🏳 You gave up this battle.";
  else if (busy) status = news ?? "Zero-Bot is aiming…";
  else status = news ? `${news} · Your turn` : "Your turn: pick a square on Zero-Bot's sea.";

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
        onFire={(c, p) => void fire(c, p)}
        theirFleet={game.ai_fleet}
        targetLabel="Zero-Bot's sea"
        yourLabel="Your fleet"
        lastTarget={lastMine && !lastMine.ping ? lastMine.cell : null}
        lastYours={lastTheirs && !lastTheirs.ping ? lastTheirs.cell : null}
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
