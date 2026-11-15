import { useEffect, useRef } from "react";
import { rooms } from "../../api/client";
import type { RoomView, SonarRoomCells } from "../../api/types";
import OnlineMatch from "../../online/OnlineMatch";
import { playSfx } from "../../platform/sound";
import { SOUND } from "./AiGame";
import Battle from "./Battle";
import { shipsOf } from "./fleet";
import Grid from "./Grid";
import Placement from "./Placement";

type Act = (fn: () => Promise<RoomView>) => Promise<boolean>;

/** Sonar with a friend in an online room. Each player hides a fleet first; whoever moves first this game fires first. */
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
  const theirs = cells.log?.filter((e) => !e.mine) ?? [];
  const lastTheirs = theirs[theirs.length - 1];
  // A sound when the friend's shot lands on you.
  const heard = useRef(theirs.length);
  useEffect(() => {
    if (theirs.length > heard.current && lastTheirs) playSfx(SOUND[lastTheirs.result.kind]);
    heard.current = theirs.length;
  }, [theirs.length, lastTheirs]);

  if (cells.phase === "placing") {
    if (!cells.your_fleet)
      return <Placement sea={look.sea} fleetSkin={look.fleet} title="Hide your fleet" doneLabel="✓ Hide my fleet" onDone={(f) => void act(() => rooms.fleet(room.code, f))} />;
    return (
      <div className="sonar-boards">
        <section>
          <h3>🛡️ Your fleet is hidden</h3>
          <Grid label="Your fleet" sea={look.sea} fleetSkin={look.fleet} ships={shipsOf(cells.your_fleet)} small />
        </section>
        <aside className="panel chess-side">
          <p>Waiting for your friend to hide their fleet…</p>
          <p className="hint">The server keeps both fleets secret. {room.you === room.first_seat ? "You fire first." : "Your friend fires first."}</p>
        </aside>
      </div>
    );
  }
  if (!cells.target || !cells.your_sea || !cells.your_fleet) return null;
  const mine = cells.log?.filter((e) => e.mine) ?? [];
  const lastMine = mine[mine.length - 1];
  return (
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
      theirFleet={cells.their_fleet}
      targetLabel="Your friend's sea"
      yourLabel="Your fleet"
      lastTarget={lastMine && !lastMine.ping ? lastMine.cell : null}
      lastYours={lastTheirs && !lastTheirs.ping ? lastTheirs.cell : null}
    />
  );
}
