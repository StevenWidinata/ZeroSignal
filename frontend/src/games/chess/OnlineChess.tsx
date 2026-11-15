import { rooms } from "../../api/client";
import type { ChessRoomInfo, RoomView } from "../../api/types";
import OnlineMatch from "../../online/OnlineMatch";
import { playSfx } from "../../platform/sound";
import ChessBoard from "./ChessBoard";
import { ENDING_TEXT } from "./endings";
import MoveList from "./MoveList";

/** Chess with a friend in an online room. Whoever moves first in a game plays White. */
export default function OnlineChess({ code, look, onExit }: { code: string; look: { board: string; pieces: string }; onExit: () => void }) {
  return (
    <OnlineMatch
      game="chess"
      code={code}
      onExit={onExit}
      leaveLabel="🏳 Resign & leave"
      renderBoard={(room, act) => <RoomBoard room={room} act={act} look={look} />}
      renderControls={(room, act) => <DrawButtons room={room} act={act} />}
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
  const info = room.board.highlight as ChessRoomInfo;
  const fen = room.board.cells as string;
  const white = room.you === room.first_seat;
  return (
    <div className="chess-layout">
      <ChessBoard
        fen={fen}
        orientation={white ? "w" : "b"}
        legal={room.your_turn ? info.legal : []}
        lastMove={info.last}
        check={info.check}
        boardStyle={look.board}
        pieceSet={look.pieces}
        onMove={(uci) => {
          playSfx("drop");
          void act(() => rooms.moveUci(room.code, uci));
        }}
      />
      <aside className="chess-side panel">
        <p className="chess-you">
          You play <strong>{white ? "White ♔" : "Black ♚"}</strong>
        </p>
        {info.ending && <p className="chess-ending">{ENDING_TEXT[info.ending] ?? info.ending}</p>}
        <MoveList san={info.san} />
      </aside>
    </div>
  );
}

function DrawButtons({ room, act }: { room: RoomView; act: (fn: () => Promise<RoomView>) => Promise<boolean> }) {
  if (room.status !== "playing" || room.game_over) return null;
  const me = room.you;
  const offer = room.draw_offer;
  if (offer === null || offer === undefined)
    return (
      <button className="btn" onClick={() => void act(() => rooms.draw(room.code, "offer"))}>
        ½ Offer a draw
      </button>
    );
  if (offer === me) return <button disabled>Draw offered… (it lapses when they move)</button>;
  return (
    <span className="g2048-confirm">
      Your friend offers a draw.
      <button className="btn-green btn-sm" onClick={() => void act(() => rooms.draw(room.code, "accept"))}>
        ✓ Accept
      </button>
      <button className="btn-ghost btn-sm" onClick={() => void act(() => rooms.draw(room.code, "decline"))}>
        ✕ Decline
      </button>
    </span>
  );
}
