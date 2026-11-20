import { useEffect, useState } from "react";
import type { SonarPowers } from "../../api/types";
import { COMBO, POWERS } from "./tactics";

const MK = ["", "", " Mk II", " Mk III"];

/**
 * Tactics: your five ship powers as cards (charge bar, READY, or lost with
 * its ship), then the Overdrive meter and your shields. Picking a
 * ready card starts aiming it; a full Overdrive can charge a card at once.
 */
export default function PowerBar({
  powers,
  aiming,
  disabled,
  shields,
  onAim,
  onOverdrive,
}: {
  powers: SonarPowers;
  /** The power being aimed, if any. */
  aiming: number | null;
  disabled: boolean;
  /** Shields guarding your ships. */
  shields: number;
  onAim: (power: number | null) => void;
  onOverdrive: (power: number) => void;
}) {
  const [charging, setCharging] = useState(false);
  useEffect(() => {
    if (!powers.overdrive || disabled) setCharging(false);
  }, [powers.overdrive, disabled]);

  return (
    <div className="sonar-powers">
      <ul className="sonar-power-cards" aria-label="Ship powers">
        {POWERS.map((p, i) => {
          const lost = powers.lost[i];
          const ready = !lost && powers.charge[i] >= powers.cooldown[i];
          const canCharge = charging && !lost && !ready;
          const pct = Math.round((100 * Math.min(powers.charge[i], powers.cooldown[i])) / powers.cooldown[i]);
          const state = lost ? "lost" : ready ? "ready" : "charging";
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`sonar-power ${state}${aiming === i ? " aiming" : ""}${canCharge ? " chargeable" : ""}`}
                disabled={disabled || (canCharge ? false : !ready)}
                aria-pressed={aiming === i}
                title={p.text}
                onClick={() => {
                  if (canCharge) {
                    setCharging(false);
                    onOverdrive(i);
                  } else onAim(aiming === i ? null : i);
                }}
              >
                <span className="sonar-power-name">
                  <span aria-hidden="true">{p.icon}</span> {p.name}
                  {MK[powers.levels[i]] && <small>{MK[powers.levels[i]]}</small>}
                </span>
                {lost ? (
                  <span className="sonar-power-state">☠ Ship sunk</span>
                ) : canCharge ? (
                  <span className="sonar-power-state">⚡ Charge it</span>
                ) : ready ? (
                  <span className="sonar-power-state">{aiming === i ? "Aiming…" : "READY"}</span>
                ) : (
                  <span className="sonar-power-state">
                    <span className="sonar-charge" aria-hidden="true">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    {powers.cooldown[i] - powers.charge[i]} more turn{powers.cooldown[i] - powers.charge[i] === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sonar-power-extras">
        {powers.overdrive ? (
          <button
            type="button"
            className={`btn-sm sonar-od${charging ? " picking" : ""}`}
            disabled={disabled || powers.charge.every((c, i) => powers.lost[i] || c >= powers.cooldown[i])}
            aria-pressed={charging}
            onClick={() => setCharging((c) => !c)}
            title="Charges one power right away and keeps your turn"
          >
            {charging ? "Pick a power to charge (or tap to cancel)" : "⚡ Overdrive ready!"}
          </button>
        ) : (
          <span className="sonar-meter" title={`${COMBO} firing moves in a row that hit fill Overdrive`}>
            ⚡ Overdrive{" "}
            <span className="sonar-charge" aria-hidden="true">
              <span style={{ width: `${(100 * powers.combo) / COMBO}%` }} />
            </span>{" "}
            {powers.combo}/{COMBO} hits in a row
          </span>
        )}
        {shields > 0 && <span title="Each shield blocks one hit on your ships">🛡️ Shield ×{shields}</span>}
      </div>
    </div>
  );
}
