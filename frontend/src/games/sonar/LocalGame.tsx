import { useState } from "react";
import { playSfx } from "../../platform/sound";
import { SOUND } from "./AiGame";
import Battle from "./Battle";
import { describe, entryOf, fxFor, powersOf, viewOf, type Fx } from "./fleet";
import Placement from "./Placement";
import { Duel, isError, moveCode, parseFleet, parseMove, SHOT_ERROR_TEXT } from "./rules";
import { CRATES, MINES, MK1 } from "./tactics";

type Phase =
  | { kind: "place"; who: 0 | 1 }
  | { kind: "cover"; who: 0 | 1; then: "place" | "turn" }
  | { kind: "turn"; who: 0 | 1 }
  | { kind: "over"; winner: 0 | 1 };

/**
 * Two players, one device. Each hides a fleet in secret, then a cover
 * screen goes up between turns so nobody sees the other fleet. Every game has
 * ship powers, mines and crates (an extra shot or Overdrive keeps the turn,
 * so no cover then). Just for fun: nothing is sent to the server.
 */
export default function LocalGame({
  names,
  look,
  onExit,
}: {
  names: [string, string];
  look: { fleet: string; sea: string };
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "place", who: 0 });
  const [fleets, setFleets] = useState<[string | null, string | null]>([null, null]);
  /** The battle: player 0 fires first; duel.seas[i] = player i's own sea. */
  const [duel, setDuel] = useState<Duel | null>(null);
  const [, setTick] = useState(0);
  const [news, setNews] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<[number | null, number | null]>([null, null]);
  const [fx, setFx] = useState<{ key: number; list: Fx[] } | null>(null);
  const [waiting, setWaiting] = useState(false);

  function restart() {
    setPhase({ kind: "place", who: 0 });
    setFleets([null, null]);
    setDuel(null);
    setNews(null);
    setError(null);
    setLastShot([null, null]);
    setFx(null);
  }

  if (phase.kind === "place")
    return (
      <Placement
        key={phase.who}
        sea={look.sea}
        fleetSkin={look.fleet}
        mines={MINES}
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
            const setup = { levels: [MK1, MK1] as [number[], number[]], seed: Math.floor(Math.random() * 2 ** 32), crates: CRATES };
            if ("ships" in a && "ships" in b) setDuel(new Duel([a, b], 0, setup));
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
            setFx(null);
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

  /** Play a move code ("f37", "p44", "a12h", …) for the player whose turn it is. */
  function play(code: string) {
    if (phase.kind !== "turn" || waiting || !duel) return;
    const m = parseMove(code);
    if (!m) return;
    const r = duel.play(m);
    if (isError(r)) {
      setError(SHOT_ERROR_TEXT[r]);
      return;
    }
    setError(null);
    setTick((t) => t + 1);
    playSfx(SOUND[r.kind]);
    const entry = entryOf(duel.log[duel.log.length - 1], me, moveCode(m));
    setNews(describe(entry, names[me], "their"));
    setFx({ key: Date.now(), list: fxFor(entry) });
    if (entry.hits.length === 1 && m.kind !== "ping" && m.kind !== "overdrive") {
      const cell = entry.hits[0].cell;
      setLastShot((l) => (me === 0 ? [cell, l[1]] : [l[0], cell]));
    }
    if (duel.winner() === me) {
      playSfx("win");
      setPhase({ kind: "over", winner: me });
      return;
    }
    const next = duel.toMove();
    // An extra shot or Overdrive keeps the turn: no cover screen.
    if (next === me) {
      setNews((s) => `${s} · ${names[me]} goes again!`);
      return;
    }
    // A moment to see the result, then cover the screen for whoever moves next.
    setWaiting(true);
    window.setTimeout(() => {
      setWaiting(false);
      setPhase({ kind: "cover", who: next, then: "turn" });
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
        onFire={(cell, ping) => play(`${ping ? "p" : "f"}${cell}`)}
        onMove={play}
        powers={over ? null : powersOf(duel, me)}
        theirPowers={powersOf(duel, them)}
        fx={fx}
        theirFleet={over ? fleets[them] : null}
        targetLabel={`${names[them]}'s sea`}
        yourLabel={`${names[me]}'s fleet`}
        lastTarget={lastShot[me]}
        lastYours={lastShot[them]}
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
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
