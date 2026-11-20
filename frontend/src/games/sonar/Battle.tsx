import { useEffect, useState } from "react";
import type { SonarPowers, SonarSea } from "../../api/types";
import { aimCode, aimHint, aimPreview, canTurn, startAim, tapAim, turnAim, type Aim } from "./aim";
import { shipsOf, type Fx } from "./fleet";
import Grid from "./Grid";
import PowerBar from "./PowerBar";
import { FLEET, parseFleet } from "./rules";
import { POWERS } from "./tactics";

export interface BattleProps {
  target: SonarSea;
  yourSea: SonarSea;
  /** Your fleet code (drawn on your grid, with your mines in Tactics). */
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
  /** Tactics: your powers and theirs (null in Classic). */
  powers?: SonarPowers | null;
  theirPowers?: SonarPowers | null;
  /** Tactics: play a move code (a power or Overdrive). */
  onMove?: (code: string) => void;
  /** Effects of the last move on each grid. */
  fx?: { key: number; list: Fx[] } | null;
  fxYours?: { key: number; list: Fx[] } | null;
}

/** Sunk or afloat (and, in Tactics, each ship's power), for the little fleet lists. */
function FleetStatus({ sea, whose, powers }: { sea: SonarSea; whose: string; powers?: SonarPowers | null }) {
  const sunk = new Set(sea.sunk.map((s) => s.ship));
  return (
    <ul className="sonar-fleet-status" aria-label={`${whose} fleet`}>
      {FLEET.map((s, i) => (
        <li key={s.id} className={sunk.has(i) ? "sunk" : ""}>
          {sunk.has(i) ? "☠" : "🚢"} {s.name}
          {powers && !sunk.has(i) && (
            <small title={POWERS[i].name}>
              {" "}
              · {POWERS[i].icon} {powers.charge[i] >= powers.cooldown[i] ? "ready" : `${powers.charge[i]}/${powers.cooldown[i]}`}
            </small>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Battle(p: BattleProps) {
  const [pingMode, setPingMode] = useState(false);
  const [aim, setAim] = useState<Aim | null>(null);
  const pingsLeft = p.target.pings_left;
  useEffect(() => {
    if (pingsLeft === 0 || !p.canFire) setPingMode(false);
  }, [pingsLeft, p.canFire]);
  useEffect(() => {
    if (!p.canFire) setAim(null);
  }, [p.canFire]);

  const sunkEnemy = p.target.sunk.map((s) => ({ ship: s.ship, cells: s.cells }));
  const yourShips = shipsOf(p.yourFleet);
  const parsed = parseFleet(p.yourFleet);
  const yourMines = "mines" in parsed ? parsed.mines : [];
  const ghosts = p.theirFleet ? shipsOf(p.theirFleet).filter((s) => !sunkEnemy.some((x) => x.ship === s.ship)) : [];

  const size = aim && p.powers ? p.powers.size[aim.power] : 0;
  const preview = aim ? aimPreview(aim, size, p.target.marks) : null;
  const code = aim ? aimCode(aim, size, p.target.marks) : null;

  function fireAim() {
    if (!code) return;
    p.onMove?.(code);
    setAim(null);
  }

  function pick(cell: number) {
    if (aim) {
      const r = tapAim(aim, cell, size, p.target.marks);
      if (r.fire) fireAim();
      else setAim(r.aim);
      return;
    }
    p.onFire(cell, pingMode);
    setPingMode(false);
  }

  return (
    <div className="sonar-battle">
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
            sweeps={p.target.sweeps}
            interactive={p.canFire}
            pingMode={pingMode}
            pickAll={!!aim}
            preview={preview}
            previewKind="aim"
            last={p.lastTarget}
            fx={p.fx}
            onPick={pick}
            onTogglePing={() => !aim && pingsLeft > 0 && setPingMode((m) => !m)}
            onRotate={aim && canTurn(aim.power) ? () => setAim((a) => (a ? turnAim(a, size) : a)) : undefined}
          />
          {aim ? (
            <div className="sonar-aim" role="group" aria-label={`Aiming ${POWERS[aim.power].name}`}>
              <p>
                <strong>
                  {POWERS[aim.power].icon} {POWERS[aim.power].name}
                </strong>{" "}
                {aimHint(aim, size)} Tap the same square again, or press Fire.
              </p>
              <div className="game-controls">
                {canTurn(aim.power) && (
                  <button className="btn-sm" onClick={() => setAim(turnAim(aim, size))} title="R">
                    ⟳ Turn
                  </button>
                )}
                <button className="btn-sm btn-green" disabled={!code} onClick={fireAim}>
                  Fire {POWERS[aim.power].icon}
                </button>
                <button className="btn-sm btn-ghost" onClick={() => setAim(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
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
          )}
          <FleetStatus sea={p.target} whose="Their" powers={p.theirPowers} />
        </section>
        <section>
          <h3>
            🛡️ {p.yourLabel}
            {p.yourSea.shields > 0 && <small> · 🛡️ ×{p.yourSea.shields}</small>}
          </h3>
          <Grid
            label={p.yourLabel}
            sea={p.sea}
            fleetSkin={p.fleetSkin}
            marks={p.yourSea.marks}
            ships={yourShips}
            sunk={p.yourSea.sunk.map((s) => s.ship)}
            mines={yourMines}
            pings={p.yourSea.pings}
            sweeps={p.yourSea.sweeps}
            last={p.lastYours}
            fx={p.fxYours}
            small
          />
          <FleetStatus sea={p.yourSea} whose="Your" />
        </section>
      </div>
      {p.powers && (
        <PowerBar
          powers={p.powers}
          aiming={aim?.power ?? null}
          disabled={!p.canFire}
          shields={p.yourSea.shields}
          onAim={(power) => {
            setPingMode(false);
            setAim(power === null ? null : startAim(power));
          }}
          onOverdrive={(power) => p.onMove?.(`o${power}`)}
        />
      )}
    </div>
  );
}
