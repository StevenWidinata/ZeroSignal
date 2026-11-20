import { useEffect, useState } from "react";
import { sonar } from "../../api/client";
import type { SonarWorkshop } from "../../api/types";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import { FLEET } from "./rules";
import { MAX_LEVEL, MK_NAME, POWERS, powerLevel, upgradeText } from "./tactics";

/** What a power does at a Mk, in a few words ("3 squares, every 6 turns"). */
function nowText(power: number, level: number): string {
  const l = powerLevel(power, level);
  const what = [`${l.size} squares in a line`, `${l.size} shots`, "a whole row or column", l.size >= 4 ? "from any edge" : "from the left or top", l.size >= 9 ? "a 3×3 area" : "a + shape"][power];
  return `${what}, ready every ${l.cooldown} turns`;
}

/**
 * The Ship Workshop: one row per Tactics power with its Mk, what the next Mk
 * improves and its price. Upgrades count vs Zero-Bot and in the Campaign.
 */
export default function Workshop({ onBack }: { onBack: () => void }) {
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);
  const [shop, setShop] = useState<SonarWorkshop | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sonar
      .workshop()
      .then(setShop)
      .catch((e) => setError(e instanceof Error ? e.message : "could not open the Workshop"));
  }, []);

  async function upgrade(power: number) {
    setBusy(true);
    setError(null);
    try {
      setShop(await sonar.upgrade(POWERS[power].id));
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not upgrade that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel sonar-workshop">
      <div className="sonar-workshop-head">
        <h2>🔧 Ship Workshop</h2>
        <span className="tag">🪙 {coins.toLocaleString()}</span>
      </div>
      <p className="hint">Upgrade your Tactics powers with coins. Upgrades count against Zero-Bot and in the Campaign; online games are always Mk I.</p>
      {!shop && !error && <div className="loading">Opening the Workshop</div>}
      {shop && (
        <ul className="sonar-workshop-rows">
          {POWERS.map((p, i) => {
            const level = shop.levels[i];
            const price = shop.next_price[i];
            return (
              <li key={p.id}>
                <div className="sonar-workshop-name">
                  <span className="sonar-workshop-icon" aria-hidden="true">
                    {p.icon}
                  </span>
                  <span>
                    <strong>{p.name}</strong> <small>({FLEET[i].name})</small>
                    <span className="sonar-mk" aria-label={`${MK_NAME[level]} of ${MK_NAME[MAX_LEVEL]}`}>
                      {MK_NAME[level]}{" "}
                      <span aria-hidden="true">
                        {"●".repeat(level)}
                        {"○".repeat(MAX_LEVEL - level)}
                      </span>
                    </span>
                  </span>
                </div>
                <div className="sonar-workshop-text">
                  <span>Now: {nowText(i, level)}</span>
                  {price !== null && (
                    <span>
                      <strong>{MK_NAME[level + 1]}:</strong> {upgradeText(i, level)}
                    </span>
                  )}
                </div>
                {price === null ? (
                  <span className="tag tag-green">MAXED</span>
                ) : (
                  <button className="btn-green btn-sm" disabled={busy || coins < price} onClick={() => void upgrade(i)} title={coins < price ? "Not enough coins yet" : undefined}>
                    Upgrade 🪙 {price}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="game-controls">
        <button className="btn-ghost" onClick={onBack}>
          ← Back to menu
        </button>
      </div>
    </div>
  );
}
