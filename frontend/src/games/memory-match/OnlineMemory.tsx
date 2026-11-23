import { rooms } from "../../api/client";
import type { MemoryCollection, MemoryRoomInfo, RoomView } from "../../api/types";
import OnlineMatch from "../../online/OnlineMatch";
import KitPicker from "./KitPicker";
import Table from "./Table";

type Act = (fn: () => Promise<RoomView>) => Promise<boolean>;

interface Shop {
  collection: MemoryCollection | null;
  coins: number;
  busy: boolean;
  onBuy: (id: string) => void;
}

/** Memory Match in an online room: pick powers (Chaos), then the shared board. */
export default function OnlineMemory({ code, onExit, shop }: { code: string; onExit: () => void; shop: Shop }) {
  return <OnlineMatch game="memory-match" code={code} onExit={onExit} renderBoard={(room, act) => <RoomBoard room={room} act={act} shop={shop} />} />;
}

function RoomBoard({ room, act, shop }: { room: RoomView; act: Act; shop: Shop }) {
  const info = room.board.highlight as MemoryRoomInfo;
  if (info.ready) return <Table room={room} act={act} />;
  const mineIn = info.kits_in[room.you - 1];
  const theirsIn = info.kits_in[2 - room.you];
  if (!mineIn && room.status === "playing" && !room.game_over)
    return (
      <KitPicker
        collection={shop.collection}
        coins={shop.coins}
        busy={shop.busy}
        rivalReady={theirsIn}
        onBuy={shop.onBuy}
        onReady={(kit) => void act(() => rooms.kit(room.code, kit.join(",")))}
      />
    );
  return (
    <div className="panel mm-wait">
      <p>✓ Your powers are packed. Waiting for your friend to pick theirs…</p>
      <p className="wam-hint">
        {room.you === room.first_seat ? "You go first." : "Your friend goes first."} You'll both see each other's powers when the game
        starts.
      </p>
    </div>
  );
}
