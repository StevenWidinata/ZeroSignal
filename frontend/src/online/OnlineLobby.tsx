import { useEffect, useState, type FormEvent } from "react";
import { rooms } from "../api/client";
import type { OnlineEntry, OnlineGame, SonarMode } from "../api/types";
import Avatar from "../character/Avatar";
import { playSfx } from "../platform/sound";

/** Online menu: start a room for a friend, or join theirs with a code. */
export default function OnlineLobby({ game, onEnter }: { game: OnlineGame; onEnter: (code: string) => void }) {
  // Chess and Sonar games are long, so one game is the default there.
  const [bestOf, setBestOf] = useState(game === "chess" || game === "sonar" || game === "checkers" ? 1 : 3);
  const [sonarMode, setSonarMode] = useState<SonarMode>("classic");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState<OnlineEntry[] | null>(null);

  useEffect(() => {
    rooms
      .leaderboard(game)
      .then(setTop)
      .catch(() => setTop([]));
  }, [game]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await rooms.create(game, bestOf, game === "sonar" ? sonarMode : undefined);
      playSfx("click");
      onEnter(r.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not open a room");
    } finally {
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const c = code.replace(/[\s-]/g, "").toUpperCase();
    if (c.length !== 6) {
      setError("A room code has 6 letters and numbers.");
      return;
    }
    playSfx("click");
    onEnter(c);
  }

  return (
    <div className="online-lobby">
      <section className="online-card">
        <h3>🌐 Start a room</h3>
        <p className="wam-hint">You get a code and a link to send to a friend on another phone or laptop.</p>
        <div className="row-label">
          <span id="online-bo">Best of</span>
          <div className="segmented" role="radiogroup" aria-labelledby="online-bo">
            {[1, 3, 5].map((n) => (
              <button key={n} role="radio" aria-checked={bestOf === n} className={`btn-sm${bestOf === n ? "" : " btn-ghost"}`} onClick={() => setBestOf(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        {game === "sonar" && (
          <div className="row-label">
            <span id="online-rules">Rules</span>
            <div className="segmented" role="radiogroup" aria-labelledby="online-rules">
              {(["classic", "tactics"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={sonarMode === m}
                  className={`btn-sm${sonarMode === m ? "" : " btn-ghost"}`}
                  onClick={() => setSonarMode(m)}
                >
                  {m === "classic" ? "🎯 Classic" : "⚡ Tactics"}
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="btn-green" onClick={() => void create()} disabled={busy}>
          {busy ? "Opening…" : "▶ Create room"}
        </button>
      </section>

      <form className="online-card" onSubmit={join}>
        <h3>🔑 Join a friend</h3>
        <p className="wam-hint">Type the 6-character code your friend sees.</p>
        <input
          className="online-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC234"
          maxLength={8}
          aria-label="Room code"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn-blue" type="submit">
          Join room
        </button>
      </form>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <section className="online-card online-top">
        <h3>🏆 Online champions</h3>
        {top === null ? (
          <div className="loading">Loading</div>
        ) : top.length === 0 ? (
          <p className="wam-hint">Nobody has won an online series yet. Be the first!</p>
        ) : (
          <ol>
            {top.slice(0, 5).map((e) => (
              <li key={e.username}>
                <Avatar loadout={e.avatar} size={28} crop="head" />
                <strong>{e.username}</strong>
                <small>
                  {e.wins} won / {e.played} played
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="wam-hint">Online series pay XP (win 30, draw 15, loss 10). Guests can play too.</p>
    </div>
  );
}
