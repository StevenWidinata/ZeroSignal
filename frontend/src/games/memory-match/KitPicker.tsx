import { useState } from "react";
import type { MemoryCollection } from "../../api/types";
import { KIT_SIZE, POWERS, findPower, toggleKit, usableKit } from "./logic";

const SAVED = "zs.memory.kit";

function loadSaved(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(kit: string[]) {
  try {
    localStorage.setItem(SAVED, JSON.stringify(kit));
  } catch {
    // Private mode: just don't remember it.
  }
}

/** Pick the 3 powers you bring into this Chaos game (your last 3 come pre-picked). */
export default function KitPicker({
  collection,
  coins,
  busy,
  rivalReady,
  onBuy,
  onReady,
}: {
  collection: MemoryCollection | null;
  coins: number;
  busy: boolean;
  rivalReady: boolean;
  onBuy: (id: string) => void;
  onReady: (kit: string[]) => void;
}) {
  const owns = (id: string) => findPower(id)?.price === null || !!collection?.powers.find((p) => p.id === id)?.owned;
  const [kit, setKit] = useState<string[]>(() => usableKit(loadSaved(), owns));
  const [focus, setFocus] = useState<string>(kit[0] ?? POWERS[0].id);
  // Drop anything you no longer own once the locker has loaded.
  const shown = kit.filter(owns);
  const detail = findPower(focus) ?? POWERS[0];

  return (
    <div className="panel mm-kit">
      <h3>
        Pick {KIT_SIZE} powers for this game <small>({shown.length}/{KIT_SIZE})</small>
      </h3>
      <div className="mm-kit-grid" role="group" aria-label="Powers">
        {POWERS.map((p) => {
          const have = owns(p.id);
          const on = shown.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`mm-kit-tile rarity-${p.rarity}${on ? " selected" : ""}${have ? "" : " locked"}`}
              aria-pressed={on}
              onClick={() => {
                setFocus(p.id);
                if (have) setKit((k) => toggleKit(k.filter(owns), p.id));
              }}
            >
              <span className="mm-kit-icon" aria-hidden="true">
                {p.icon}
              </span>
              <strong>{p.name}</strong>
              <small>{on ? "✓ picked" : have ? (p.price === null ? "free" : "owned") : `🔒 ${p.price}`}</small>
            </button>
          );
        })}
      </div>
      <p className="mm-kit-detail" aria-live="polite">
        <strong>
          {detail.icon} {detail.name}:
        </strong>{" "}
        {detail.text}
        {!owns(detail.id) && detail.price !== null && collection && (
          <button className="btn-green btn-sm" onClick={() => onBuy(detail.id)} disabled={busy || coins < detail.price}>
            Buy for 🪙 {detail.price.toLocaleString()}
          </button>
        )}
      </p>
      {shown.length === KIT_SIZE && !kit.includes(focus) && owns(focus) && <p className="wam-hint">Unpick one first to swap it.</p>}
      <div className="mm-kit-foot">
        <button
          className="btn-green"
          disabled={shown.length !== KIT_SIZE || busy}
          onClick={() => {
            save(shown);
            onReady(shown);
          }}
        >
          ✓ Ready
        </button>
        <span className="wam-hint">{rivalReady ? "Your friend is ready." : "Your friend is picking…"} Each power works once this game.</span>
      </div>
    </div>
  );
}
