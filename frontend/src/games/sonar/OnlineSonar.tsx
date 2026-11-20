import { useEffect, useRef, useState } from "react";
import { rooms } from "../../api/client";
import type { RoomView, SonarRoomCells } from "../../api/types";
import OnlineMatch from "../../online/OnlineMatch";
import { playSfx } from "../../platform/sound";
import { SOUND } from "./AiGame";
import Battle from "./Battle";
import { describe, fxFor, shipsOf, type Fx } from "./fleet";
import Grid from "./Grid";
import Placement from "./Placement";
import { parseFleet } from "./rules";
import { MINES } from "./tactics";

type Act = (fn: () => Promise<RoomView>) => Promise<boolean>;

/**
 * Sonar with a friend in an online room. Each player hides a fleet first
 * (and mines, in a Tactics room); whoever moves first this game fires first.
 */
export default function OnlineSonar({ code, look, onExit }: { code: string; look: { fleet: string; sea: string }; onExit: () => void }) {
  return (
    <OnlineMatch
      game="sonar"
      code={code}
      onExit={onExit}
      leaveLabel="🏳 Give up & leave"
      renderBoard={(room, act) => <RoomBoard room={room} act={act} look={look} />}
    />
  );
}

function RoomBoard({ room, act, look }: { room: RoomView; act: Act; look: { fleet: string; sea: string } }) {
  const cells = room.board.cells as SonarRoomCells;
  const tactics = cells.mode === "tactics";
  const log = cells.log ?? [];
  const theirs = log.filter((e) => !e.mine);
  const mine = log.filter((e) => e.mine);
  const lastTheirs = theirs[theirs.length - 1];
  const lastMine = mine[mine.length - 1];
  const [fx, setFx] = useState<{ key: number; list: Fx[] } | null>(null);
  const [fxYours, setFxYours] = useState<{ key: number; list: Fx[] } | null>(null);

  // Sounds and effects when new moves arrive (yours from your own taps, your friend's from polling).
  const seen = useRef(log.length);
  useEffect(() => {
    if (log.length < seen.current) seen.current = 0; // a new game started
    const fresh = log.slice(seen.current);
    seen.current = log.length;
    const you = fresh.filter((e) => e.mine).pop();
    const friend = fresh.filter((e) => !e.mine).pop();
    if (you) setFx({ key: Date.now(), list: fxFor(you) });
    if (friend) {
      playSfx(SOUND[friend.result.kind]);
      setFxYours({ key: Date.now() + 1, list: fxFor(friend) });
    }
  }, [log]);

  if (cells.phase === "placing") {
    if (!cells.your_fleet)
      return (
        <>
          {tactics && <p className="hint">⚡ Tactics room: ship powers, 2 mines each, supply crates and Overdrive.</p>}
          <Placement
            sea={look.sea}
            fleetSkin={look.fleet}
            mines={tactics ? MINES : 0}
            title="Hide your fleet"
            doneLabel="✓ Hide my fleet"
            onDone={(f) => void act(() => rooms.fleet(room.code, f))}
          />
        </>
      );
    const parsed = parseFleet(cells.your_fleet);
    return (
      <div className="sonar-boards">
        <section>
          <h3>🛡️ Your fleet is hidden</h3>
          <Grid label="Your fleet" sea={look.sea} fleetSkin={look.fleet} ships={shipsOf(cells.your_fleet)} mines={"mines" in parsed ? parsed.mines : []} small />
        </section>
        <aside className="panel chess-side">
          <p>Waiting for your friend to hide their fleet…</p>
          <p className="hint">The server keeps both fleets secret. {room.you === room.first_seat ? "You fire first." : "Your friend fires first."}</p>
        </aside>
      </div>
    );
  }
  if (!cells.target || !cells.your_sea || !cells.your_fleet) return null;
  const showCell = (e: typeof lastMine | undefined) => (e && !e.ping && e.hits.length === 1 ? e.hits[0].cell : null);
  const active = !room.game_over;
  return (
    <>
      {(lastMine || lastTheirs) && (
        <p className="hint" role="status" aria-live="polite">
          {[lastMine && describe(lastMine, "You", "their"), lastTheirs && describe(lastTheirs, "Your friend", "your")].filter(Boolean).join(" · ")}
        </p>
      )}
      <Battle
        target={cells.target}
        yourSea={cells.your_sea}
        yourFleet={cells.your_fleet}
        fleetSkin={look.fleet}
        sea={look.sea}
        canFire={room.your_turn}
        onFire={(cell, ping) => {
          playSfx(ping ? "zap" : "click");
          void act(() => rooms.fire(room.code, cell, ping));
        }}
        onMove={(move) => {
          playSfx("click");
          void act(() => rooms.sonarMove(room.code, move));
        }}
        powers={active ? cells.powers : null}
        theirPowers={cells.their_powers}
        fx={fx}
        fxYours={fxYours}
        theirFleet={cells.their_fleet}
        targetLabel="Your friend's sea"
        yourLabel="Your fleet"
        lastTarget={showCell(lastMine)}
        lastYours={showCell(lastTheirs)}
      />
    </>
  );
}
