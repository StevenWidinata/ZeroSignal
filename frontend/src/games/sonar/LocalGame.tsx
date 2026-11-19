import { useState } from "react";
import { playSfx } from "../../platform/sound";
import { SOUND } from "./AiGame";
import Battle from "./Battle";
import { label, resultText, viewOf } from "./fleet";
import Placement from "./Placement";
import { Duel, isError, parseFleet } from "./rules";

type Phase =
  | { kind: "place"; who: 0 | 1 }
  | { kind: "cover"; who: 0 | 1; then: "place" | "turn" }
  | { kind: "turn"; who: 0 | 1 }
  | { kind: "over"; winner: 0 | 1 };

/**
 * Two players, one device. Each hides a fleet in secret, then a cover
 * screen goes up between turns so nobody sees the other fleet. Just for fun:
 * nothing is sent to the server.
 */
export default function LocalGame({ names, look, onExit }: { names: [string, string]; look: { fleet: string; sea: string }; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "place", who: 0 });
  const [fleets, setFleets] = useState<[string | null, string | null]>([null, null]);
  /** The battle: player 0 fires first; duel.seas[i] = player i's own sea. */
  const [duel, setDuel] = useState<Duel | null>(null);
  const [, setTick] = useState(0);
  const [news, setNews] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<[number | null, number | null]>([null, null]);
  const [waiting, setWaiting] = useState(false);

  function restart() {
    setPhase({ kind: "place", who: 0 });
    setFleets([null, null]);
    setDuel(null);
    setNews(null);
    setLastShot([null, null]);
  }

  if (phase.kind === "place")
    return (
      <Placement
        key={phase.who}
        sea={look.sea}
        fleetSkin={look.fleet}
        title={`${names[phase.who]}: hide your fleet`}
        doneLabel={phase.who === 0 ? "✓ Done, hide it" : "✓ Done, start the battle"}
        onDone={(code) => {
          const next: [string | null, string | null] = [...fleets];
          next[phase.who] = code;
          setFleets(next);
          if (phase.who === 0) setPhase({ kind: "cover", who: 1, then: "place" });
          else {
            const a = parseFleet(next[0]!);
            const b = parseFleet(code);
            if ("ships" in a && "ships" in b) setDuel(new Duel([a.ships, b.ships], 0));
            setPhase({ kind: "cover", who: 0, then: "turn" });
          }
        }}
      />
    );

  if (phase.kind === "cover")
    return (
      <div className="panel sonar-cover">
        <span style={{ fontSize: "3rem" }} aria-hidden="true">
          🙈
        </span>
        <h2>Hand the device to {names[phase.who]}</h2>
        <p className="hint">{phase.then === "place" ? "Time to hide the second fleet. No peeking!" : "The boards are hidden so nobody sees the other fleet."}</p>
        {news && <p>{news}</p>}
        <button
          className="btn-green"
          onClick={() => {
            playSfx("click");
            setPhase(phase.then === "place" ? { kind: "place", who: phase.who } : { kind: "turn", who: phase.who });
          }}
        >
          I'm {names[phase.who]}: show my boards
        </button>
        <button className="btn-ghost btn-sm" onClick={onExit}>
          ← Menu
        </button>
      </div>
    );

  if (!duel || !fleets[0] || !fleets[1]) return null;
  const seas = duel.seas;
  const me = phase.kind === "turn" ? phase.who : phase.winner;
  const them = (1 - me) as 0 | 1;

  function fire(cell: number, ping: boolean) {
    if (phase.kind !== "turn" || waiting || !duel) return;
    const r = duel.play({ kind: ping ? "ping" : "fire", cell });
    if (isError(r)) return;
    setTick((t) => t + 1);
    playSfx(SOUND[r.kind]);
    const text = `${names[me]} ${ping ? "pinged" : "fired at"} ${label(cell)}: ${resultText(r)}`;
    setNews(text);
    if (!ping) setLastShot((l) => (me === 0 ? [cell, l[1]] : [l[0], cell]));
    if (duel.winner() === me) {
      playSfx("win");
      setPhase({ kind: "over", winner: me });
      return;
    }
    // A moment to see the result, then cover the screen for whoever moves next.
    const next = duel.toMove();
    setWaiting(true);
    window.setTimeout(() => {
      setWaiting(false);
      setPhase(next === me ? { kind: "turn", who: me } : { kind: "cover", who: next, then: "turn" });
    }, 1300);
  }

  const over = phase.kind === "over";
  return (
    <div className="c4-play sonar-play">
      <div className="status-bar" role="status" aria-live="polite">
        {over ? `🏆 ${names[me]} sank the whole fleet and wins!` : waiting ? news : `${names[me]}'s turn${news ? ` · last: ${news}` : ""}`}
      </div>
      <Battle
        target={viewOf(seas[them])}
        yourSea={viewOf(seas[me])}
        yourFleet={fleets[me]!}
        fleetSkin={look.fleet}
        sea={look.sea}
        canFire={!over && !waiting}
        onFire={fire}
        theirFleet={over ? fleets[them] : null}
        targetLabel={`${names[them]}'s sea`}
        yourLabel={`${names[me]}'s fleet`}
        lastTarget={lastShot[me]}
        lastYours={lastShot[them]}
      />
      <div className="game-controls">
        {over && (
          <button className="btn-green" onClick={restart}>
            ↻ New battle
          </button>
        )}
        <button className="btn-ghost" onClick={onExit}>
          ← Menu
        </button>
      </div>
      <p className="hint">Same-device games are just for fun: no coins or leaderboard points.</p>
    </div>
  );
}
