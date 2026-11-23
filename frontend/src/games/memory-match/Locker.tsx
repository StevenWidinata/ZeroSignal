import type { MemoryCollection } from "../../api/types";
import { POWERS } from "./logic";

/** All 10 power-ups: what each does, and buy the ones you don't own yet. */
export default function Locker({
  collection,
  coins,
  busy,
  onBuy,
}: {
  collection: MemoryCollection | null;
  coins: number;
  busy: boolean;
  onBuy: (id: string) => void;
}) {
  const owned = (id: string) => POWERS.find((p) => p.id === id)?.price === null || !!collection?.powers.find((p) => p.id === id)?.owned;
  return (
    <ul className="mm-locker">
      {POWERS.map((p) => {
        const have = owned(p.id);
        return (
          <li key={p.id} className={`mm-locker-row rarity-${p.rarity}`}>
            <span className="mm-locker-icon" aria-hidden="true">
              {p.icon}
            </span>
            <span className="mm-locker-text">
              <strong>{p.name}</strong>
              <small>{p.text}</small>
            </span>
            {p.price === null ? (
              <span className="mm-tag">Free</span>
            ) : have ? (
              <span className="mm-tag mm-tag-owned">✓ Owned</span>
            ) : collection ? (
              <button className="btn-green btn-sm" onClick={() => onBuy(p.id)} disabled={busy || coins < p.price}>
                🪙 {p.price.toLocaleString()}
              </button>
            ) : (
              <small>🔒 {p.price.toLocaleString()}</small>
            )}
          </li>
        );
      })}
    </ul>
  );
}
