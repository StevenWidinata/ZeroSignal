import { useState } from "react";
import { checkers } from "../../api/client";
import type { CheckersCollection, WamItemView } from "../../api/types";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Board from "./Board";
import { BoardSwatch, PiecesSwatch } from "./common";

const RARITY_LABEL = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" } as const;
/** A mid-game position with both kinds of pieces and a king each. */
const PREVIEW = [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 2, 0, 0, 0, 0, -2, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0];

/** Boards and piece sets: try them on, buy with coins (or win them as lucky drops). */
export default function Shop({
  collection,
  onCollection,
  onBack,
}: {
  collection: CheckersCollection | null;
  onCollection: (c: CheckersCollection) => void;
  onBack: () => void;
}) {
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);
  const [preview, setPreview] = useState({ board: "classic", pieces: "classic" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(kind: "board" | "pieces", it: WamItemView) {
    setBusy(true);
    setError(null);
    try {
      onCollection(await checkers.buy(kind, it.id));
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBusy(false);
    }
  }

  if (!collection) return <div className="loading">Loading the shop</div>;

  const card = (kind: "board" | "pieces", it: WamItemView) => (
    <li key={it.id} className={`ck-shop-item rarity-${it.rarity}${preview[kind] === it.id ? " selected" : ""}`}>
      <button
        type="button"
        className="ck-shop-preview"
        onClick={() => setPreview((p) => ({ ...p, [kind]: it.id }))}
        aria-label={`Preview ${it.name}`}
      >
        {kind === "board" ? <BoardSwatch id={it.id} size={52} /> : <PiecesSwatch id={it.id} size={52} />}
      </button>
      <strong>{it.name}</strong>
      <small>{RARITY_LABEL[it.rarity]}</small>
      {it.owned ? (
        <span className="tag tag-green">{it.price === null ? "Free" : "Owned"}</span>
      ) : (
        <button className="btn-green btn-sm" disabled={busy || coins < (it.price ?? 0)} onClick={() => void buy(kind, it)}>
          🪙 {it.price?.toLocaleString()}
        </button>
      )}
    </li>
  );

  return (
    <div className="ck-shop">
      <div className="ck-layout">
        <Board cells={PREVIEW} bottom="light" legal={[]} boardStyle={preview.board} pieceSet={preview.pieces} onMove={() => undefined} />
        <aside className="ck-side panel">
          <h3>🛍 Boards & pieces</h3>
          <p className="hint">Tap any style to try it on the board. Wins vs Hard or Master can also drop one for free (20% chance).</p>
          <p>
            You have <strong>🪙 {coins.toLocaleString()}</strong>
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="btn-ghost" onClick={onBack}>
            ← Back to menu
          </button>
        </aside>
      </div>
      <h3 className="section-title">
        Boards · {collection.boards.filter((b) => b.owned).length}/{collection.boards.length}
      </h3>
      <ul className="ck-shop-grid">{collection.boards.map((b) => card("board", b))}</ul>
      <h3 className="section-title">
        Piece sets · {collection.pieces.filter((p) => p.owned).length}/{collection.pieces.length}
      </h3>
      <ul className="ck-shop-grid">{collection.pieces.map((p) => card("pieces", p))}</ul>
    </div>
  );
}
