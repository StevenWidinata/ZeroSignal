import { useState } from "react";
import { chess } from "../../api/client";
import type { ChessCollection, ChessItemView } from "../../api/types";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import ChessBoard from "./ChessBoard";
import { BoardSwatch, PiecesSwatch } from "./Swatches";

const RARITY_LABEL = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" } as const;
const PREVIEW_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

/** Board styles and piece sets: try them on, buy with coins (or win them as lucky drops). */
export default function Shop({
  collection,
  onCollection,
  onBack,
}: {
  collection: ChessCollection | null;
  onCollection: (c: ChessCollection) => void;
  onBack: () => void;
}) {
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);
  const [preview, setPreview] = useState({ board: "classic", pieces: "classic" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(kind: "board" | "pieces", it: ChessItemView) {
    setBusy(true);
    setError(null);
    try {
      onCollection(await chess.buy(kind, it.id));
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBusy(false);
    }
  }

  if (!collection) return <div className="loading">Loading the shop</div>;

  const card = (kind: "board" | "pieces", it: ChessItemView) => (
    <li key={it.id} className={`chess-shop-item rarity-${it.rarity}${preview[kind === "board" ? "board" : "pieces"] === it.id ? " selected" : ""}`}>
      <button
        type="button"
        className="chess-shop-preview"
        onClick={() => setPreview((p) => (kind === "board" ? { ...p, board: it.id } : { ...p, pieces: it.id }))}
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
    <div className="chess-shop">
      <div className="chess-layout">
        <ChessBoard
          fen={PREVIEW_FEN}
          orientation="w"
          legal={[]}
          lastMove="g8f6"
          boardStyle={preview.board}
          pieceSet={preview.pieces}
          onMove={() => undefined}
        />
        <aside className="chess-side panel">
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
      <h3 className="section-title">Boards · {collection.boards.filter((b) => b.owned).length}/{collection.boards.length}</h3>
      <ul className="chess-shop-grid">{collection.boards.map((b) => card("board", b))}</ul>
      <h3 className="section-title">Piece sets · {collection.pieces.filter((p) => p.owned).length}/{collection.pieces.length}</h3>
      <ul className="chess-shop-grid">{collection.pieces.map((p) => card("pieces", p))}</ul>
    </div>
  );
}
