import { rooms } from "../../api/client";
import type { CheckersRoomInfo, RoomView } from "../../api/types";
import OnlineMatch from "../../online/OnlineMatch";
import { playSfx } from "../../platform/sound";
import Board from "./Board";
import { ENDING_TEXT, SidePanel } from "./common";

/** Checkers with a friend in an online room. Whoever moves first in a game plays Dark. */
export default function OnlineCheckers({ code, look, onExit }: { code: string; look: { board: string; pieces: string }; onExit: () => void }) {
  return (
    <OnlineMatch
      game="checkers"
      code={code}
      onExit={onExit}
      leaveLabel="🏳 Resign & leave"
      renderBoard={(room, act) => <RoomBoard room={room} act={act} look={look} />}
    />
  );
}

function RoomBoard({
  room,
  act,
  look,
}: {
  room: RoomView;
  act: (fn: () => Promise<RoomView>) => Promise<boolean>;
  look: { board: string; pieces: string };
}) {
  const info = room.board.highlight as unknown as CheckersRoomInfo;
  const cells = room.board.cells as number[];
  const dark = room.you === room.first_seat;
  return (
    <div className="ck-layout">
      <Board
        cells={cells}
        bottom={dark ? "dark" : "light"}
        legal={room.your_turn ? info.legal : []}
        lastMove={info.moves[info.moves.length - 1] ?? null}
        boardStyle={look.board}
        pieceSet={look.pieces}
        onMove={(mv) => {
          playSfx(mv.includes("x") ? "clank" : "drop");
          void act(() => rooms.moveUci(room.code, mv));
        }}
      />
      <SidePanel
        you={`You play ${dark ? "Dark ⚫ (you move first)" : "Light ⚪"}`}
        cells={cells}
        moves={info.moves}
        quietLeft={room.game_over ? undefined : info.quiet_left}
        extra={info.ending && <p>{ENDING_TEXT[info.ending] ?? info.ending}</p>}
      />
    </div>
  );
}
