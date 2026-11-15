import { useEffect, useRef, useState } from "react";
import { sonar } from "../../api/client";
import type { SonarDaily } from "../../api/types";
import { MyReaction } from "../../character/Live";
import { SaveScorePrompt } from "../../components/Guest";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { SOUND } from "./AiGame";
import { label, resultText, shipsOf } from "./fleet";
import Grid from "./Grid";
import { FLEET } from "./rules";

/** The Daily Hunt: everyone hunts the same hidden fleet today. Fewer shots = more points. */
export default function DailyHunt({ look, onExit }: { look: { fleet: string; sea: string }; onExit: () => void }) {
  const [d, setD] = useState<SonarDaily | null>(null);
  const [busy, setBusy] = useState(false);
  const [pingMode, setPingMode] = useState(false);
  const [news, setNews] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
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

  async function fire(cell: number) {
    if (busy || done) return;
    const ping = pingMode;
    setBusy(true);
    setError(null);
    try {
      const next = await sonar.dailyFire(cell, ping);
      if (!mounted.current) return;
      setD(next);
      setPingMode(false);
      setLast(ping ? null : cell);
      if (next.last) {
        playSfx(SOUND[next.last.kind]);
        setNews(`${ping ? "Ping" : "Shot"} at ${label(cell)}: ${resultText(next.last)}`);
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

  const sunk = d.target.sunk.map((s) => ({ ship: s.ship, cells: s.cells }));
  const sunkIds = new Set(sunk.map((s) => s.ship));
  const status = done
    ? `🎯 Fleet found in ${d.target.shots} shots!${d.points !== null ? ` +${d.points} points.` : ""} A new fleet hides at midnight WIB.`
    : (news ?? "Find and sink the hidden fleet in as few shots as you can. Pings count as shots.");

  return (
    <div className="c4-play sonar-play">
      <div className="chess-puzzle-head">
        <strong>📅 Daily Hunt · {d.day}</strong>
        <span>🎯 {d.target.shots} shot{d.target.shots === 1 ? "" : "s"}</span>
        <span>📡 {d.target.pings_left} pings left</span>
      </div>
      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>
      <div className="sonar-boards">
        <section>
          <Grid
            label="Today's hidden fleet"
            sea={look.sea}
            fleetSkin={look.fleet}
            marks={d.target.marks}
            ships={sunk}
            sunk={sunk.map((s) => s.ship)}
            ghosts={done ? shipsOf(d.fleet).filter((s) => !sunkIds.has(s.ship)) : []}
            pings={d.target.pings}
            interactive={!done && !busy}
            pingMode={pingMode}
            last={last}
            onPick={(c) => void fire(c)}
            onTogglePing={() => d.target.pings_left > 0 && setPingMode((m) => !m)}
          />
          {!done && (
            <div className="sonar-actions">
              <button
                className={`btn-sm${pingMode ? "" : " btn-ghost"}`}
                aria-pressed={pingMode}
                disabled={d.target.pings_left === 0 || busy}
                onClick={() => setPingMode((m) => !m)}
              >
                📡 Sonar ping ({d.target.pings_left} left)
              </button>
            </div>
          )}
        </section>
        <aside className="panel chess-side">
          <h3>Ships to find</h3>
          <ul className="sonar-fleet-status">
            {FLEET.map((s, i) => (
              <li key={s.id} className={sunkIds.has(i) ? "sunk" : ""}>
                {sunkIds.has(i) ? "☠" : "❓"} {s.name} ({s.len})
              </li>
            ))}
          </ul>
          <p className="hint">Finish in 30 shots or fewer for 40 coins (45 or fewer: 25, else 15). Points = 101 − shots. One try a day.</p>
        </aside>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className="panel wam-results">
          <MyReaction pose={d.target.shots <= 45 ? "cheer" : "wave"} />
          <h3>Hunt complete</h3>
          <div className="wam-stats">
            <span>
              <strong>{d.target.shots}</strong> shots
            </span>
            {d.points !== null && (
              <span>
                <strong>+{d.points}</strong> points
              </span>
            )}
          </div>
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
