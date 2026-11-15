import { useState } from "react";
import { sonar } from "../../api/client";
import type { ChessItemView, SonarCollection } from "../../api/types";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { shipsOf } from "./fleet";
import Grid from "./Grid";
import { FleetSwatch, SeaSwatch } from "./Swatches";

const RARITY_LABEL = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" } as const;
const PREVIEW_FLEET = "b2h b5v e9h h3v h7h";
const PREVIEW_MARKS = (() => {
  const m = ".".repeat(100).split("");
  for (const [c, v] of [[44, "o"], [11, "x"], [58, "o"], [90, "o"]] as const) m[c] = v;
  return m.join("");
})();

/** Fleet looks and seas: try them on, buy with coins (or win them as lucky drops). */
export default function Shop({ collection, onCollection, onBack }: { collection: SonarCollection | null; onCollection: (c: SonarCollection) => void; onBack: () => void }) {
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);
  const [preview, setPreview] = useState({ fleet: "navy", sea: "ocean" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(kind: "fleet" | "sea", it: ChessItemView) {
    setBusy(true);
    setError(null);
    try {
      onCollection(await sonar.buy(kind, it.id));
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBusy(false);
    }
  }

  if (!collection) return <div className="loading">Loading the shop</div>;

  const card = (kind: "fleet" | "sea", it: ChessItemView) => (
    <li key={it.id} className={`chess-shop-item rarity-${it.rarity}${preview[kind] === it.id ? " selected" : ""}`}>
      <button type="button" className="chess-shop-preview" onClick={() => setPreview((p) => ({ ...p, [kind]: it.id }))} aria-label={`Preview ${it.name}`}>
        {kind === "fleet" ? <FleetSwatch id={it.id} size={52} /> : <SeaSwatch id={it.id} size={52} />}
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
      <div className="sonar-placement">
        <Grid label="Preview" sea={preview.sea} fleetSkin={preview.fleet} ships={shipsOf(PREVIEW_FLEET)} marks={PREVIEW_MARKS} pings={[{ center: 33, count: 2 }]} />
        <aside className="chess-side panel">
          <h3>🛍 Fleets & seas</h3>
          <p className="hint">Tap any style to try it on. Wins vs Hard or Master can also drop one for free (20% chance).</p>
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
      <h3 className="section-title">Fleets · {collection.fleets.filter((f) => f.owned).length}/{collection.fleets.length}</h3>
      <ul className="chess-shop-grid">{collection.fleets.map((f) => card("fleet", f))}</ul>
      <h3 className="section-title">Seas · {collection.seas.filter((s) => s.owned).length}/{collection.seas.length}</h3>
      <ul className="chess-shop-grid">{collection.seas.map((s) => card("sea", s))}</ul>
    </div>
  );
}
