import { useEffect, useState } from "react";
import type { SonarSea } from "../../api/types";
import { shipsOf } from "./fleet";
import Grid from "./Grid";
import { FLEET } from "./rules";

export interface BattleProps {
  target: SonarSea;
  yourSea: SonarSea;
  /** Your fleet code (drawn on your grid). */
  yourFleet: string;
  fleetSkin: string;
  sea: string;
  canFire: boolean;
  onFire: (cell: number, ping: boolean) => void;
  /** The other fleet, once the game is over (drawn faintly). */
  theirFleet?: string | null;
  targetLabel: string;
  yourLabel: string;
  lastTarget?: number | null;
  lastYours?: number | null;
}

/** Sunk or afloat, for the little fleet lists. */
function FleetStatus({ sea, whose }: { sea: SonarSea; whose: string }) {
  const sunk = new Set(sea.sunk.map((s) => s.ship));
  return (
    <ul className="sonar-fleet-status" aria-label={`${whose} fleet`}>
      {FLEET.map((s, i) => (
        <li key={s.id} className={sunk.has(i) ? "sunk" : ""}>
          {sunk.has(i) ? "☠" : "🚢"} {s.name}
        </li>
      ))}
    </ul>
  );
}

export default function Battle(p: BattleProps) {
  const [pingMode, setPingMode] = useState(false);
  const pingsLeft = p.target.pings_left;
  useEffect(() => {
    if (pingsLeft === 0 || !p.canFire) setPingMode(false);
  }, [pingsLeft, p.canFire]);

  const sunkEnemy = p.target.sunk.map((s) => ({ ship: s.ship, cells: s.cells }));
  const yourShips = shipsOf(p.yourFleet);
  const ghosts = p.theirFleet ? shipsOf(p.theirFleet).filter((s) => !sunkEnemy.some((x) => x.ship === s.ship)) : [];

  return (
    <div className="sonar-boards">
      <section>
        <h3>🎯 {p.targetLabel}</h3>
        <Grid
          label={p.targetLabel}
          sea={p.sea}
          fleetSkin={p.fleetSkin}
          marks={p.target.marks}
          ships={sunkEnemy}
          sunk={sunkEnemy.map((s) => s.ship)}
          ghosts={ghosts}
          pings={p.target.pings}
          interactive={p.canFire}
          pingMode={pingMode}
          last={p.lastTarget}
          onPick={(cell) => {
            p.onFire(cell, pingMode);
            setPingMode(false);
          }}
          onTogglePing={() => pingsLeft > 0 && setPingMode((m) => !m)}
        />
        <div className="sonar-actions">
          <button
            className={`btn-sm${pingMode ? "" : " btn-ghost"}`}
            aria-pressed={pingMode}
            disabled={!p.canFire || pingsLeft === 0}
            onClick={() => setPingMode((m) => !m)}
            title="P"
          >
            📡 Sonar ping ({pingsLeft} left)
          </button>
          <small className="hint">
            {pingMode ? "Tap a square: the ping counts ship squares in the 3×3 around it." : "Tap a square to fire. Shots: " + p.target.shots}
          </small>
        </div>
        <FleetStatus sea={p.target} whose="Their" />
      </section>
      <section>
        <h3>🛡️ {p.yourLabel}</h3>
        <Grid
          label={p.yourLabel}
          sea={p.sea}
          fleetSkin={p.fleetSkin}
          marks={p.yourSea.marks}
          ships={yourShips}
          sunk={p.yourSea.sunk.map((s) => s.ship)}
          pings={p.yourSea.pings}
          last={p.lastYours}
          small
        />
        <FleetStatus sea={p.yourSea} whose="Your" />
      </section>
    </div>
  );
}
