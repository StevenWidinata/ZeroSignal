import { useEffect, useRef, useState } from "react";
import ShareDaily from "../../components/dailies/ShareDaily";
import { sonar } from "../../api/client";
import type { SonarDaily, SonarLogEntry } from "../../api/types";
import { MyReaction } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { pingBus } from "../../mascot/bus";
import { useWallet } from "../../store/wallet";
import { SOUND } from "./AiGame";
import Battle from "./Battle";
import { describe, fxFor, type Fx } from "./fleet";
import { FLEET } from "./rules";

/**
 * The Daily Hunt: everyone hunts the same hidden fleet today, with all five
 * ship powers (Mk I). Every shot, ping and power is a move; fewer moves =
 * more points. Overdrive and an Extra shot crate don't count.
 */
export default function DailyHunt({ look, onExit }: { look: { fleet: string; sea: string }; onExit: () => void }) {
  const [d, setD] = useState<SonarDaily | null>(null);
  const [busy, setBusy] = useState(false);
  const [news, setNews] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [fx, setFx] = useState<{ key: number; list: Fx[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    sonar
      .daily()
      .then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : "could not load today's hunt"));
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!d) return error ? <div className="error">{error}</div> : <div className="loading">Loading today's hunt</div>;

  const done = d.status === "done";

  /** A shot or ping (`cell`), or a power / Overdrive move code. */
  async function send(move: { cell: number; ping: boolean } | { code: string }) {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    playSfx("cell" in move && move.ping ? "zap" : "click");
    if ("cell" in move && move.ping) pingBus.emit({ type: "sonar-ping" });
    try {
      const next = "code" in move ? await sonar.dailyMove(move.code) : await sonar.dailyFire(move.cell, move.ping);
      if (!mounted.current) return;
      setD(next);
      if (next.last) {
        const code = "code" in move ? move.code : `${move.ping ? "p" : "f"}${move.cell}`;
        const entry: SonarLogEntry = {
          mine: true,
          move: code,
          cell: "cell" in move ? move.cell : (next.last_hits[0]?.cell ?? 0),
          ping: "cell" in move && move.ping,
          result: next.last,
          hits: next.last_hits,
          own: [],
        };
        playSfx(SOUND[next.last.kind]);
        setFx({ key: Date.now(), list: fxFor(entry) });
        setLast("cell" in move && !move.ping ? move.cell : null);
        setNews(describe(entry, "You", "their") + (next.last_free ? " · free, it doesn't count as a move!" : ""));
      }
      if (next.status === "done") {
        playSfx("win");
        useWallet.getState().celebrate(next.rewards);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "that didn't work");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const sunkIds = new Set(d.target.sunk.map((s) => s.ship));
  const moves = d.target.shots;
  const status = done
    ? `🎯 Fleet found in ${moves} moves!${d.points !== null ? ` +${d.points} points.` : ""} A new fleet hides at midnight WIB.`
    : (news ?? "Find and sink the hidden fleet in as few moves as you can. Shots, pings and powers each count as a move.");

  const side = (
    <aside className="panel chess-side">
      <h3>Ships to find</h3>
      <ul className="sonar-fleet-status">
        {FLEET.map((s, i) => (
          <li key={s.id} className={sunkIds.has(i) ? "sunk" : ""}>
            {sunkIds.has(i) ? "☠" : "❓"} {s.name} ({s.len})
          </li>
        ))}
      </ul>
      <p className="hint">
        You have all five ship powers. Each shot, ping or power is one move; Overdrive and an 🎯 Extra shot crate are free. Their
        submarine hides from pings and radar until it sinks. 3 supply crates hide in today's sea.
      </p>
      <p className="hint">Finish in 30 moves or fewer for 40 coins (45 or fewer: 25, else 15). Points = 101 − moves. One try a day.</p>
    </aside>
  );

  return (
    <div className="c4-play sonar-play">
      <div className="chess-puzzle-head">
        <strong>📅 Daily Hunt · {d.day}</strong>
        <span>
          🎯 {moves} move{moves === 1 ? "" : "s"}
        </span>
        <span>📡 {d.target.pings_left} pings left</span>
      </div>
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <Battle
        target={d.target}
        fleetSkin={look.fleet}
        sea={look.sea}
        canFire={!done && !busy}
        onFire={(cell, ping) => void send({ cell, ping })}
        onMove={(code) => void send({ code })}
        powers={done ? null : d.powers}
        theirFleet={done ? d.fleet : null}
        fx={fx}
        targetLabel="Today's hidden fleet"
        lastTarget={last}
        side={side}
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className="panel wam-results">
          <MyReaction pose={moves <= 45 ? "cheer" : "wave"} />
          <h3>Hunt complete</h3>
          <div className="wam-stats">
            <span>
              <strong>{moves}</strong> moves
            </span>
            {d.points !== null && (
              <span>
                <strong>+{d.points}</strong> points
              </span>
            )}
          </div>
          <ShareDaily
            gameId="sonar"
            headline={`🎯 Fleet found in ${moves} moves`}
            detail={`📡 ${d.target.pings.length} pings used${d.points !== null ? ` · ${d.points} pts` : ""}`}
          />
        </div>
      )}
      <div className="game-controls">
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      {done && <SaveScorePrompt />}
    </div>
  );
}
