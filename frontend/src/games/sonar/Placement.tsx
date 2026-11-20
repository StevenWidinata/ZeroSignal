import { useEffect, useRef, useState } from "react";
import { playSfx } from "../../platform/sound";
import { shipsOf } from "./fleet";
import Grid from "./Grid";
import { FLEET, FLEET_ERROR_TEXT, fleetCode, neighbours, occupancy, randomFleet, shipCells, validateFleet, validateMines, type Placement as P } from "./rules";
import ShipArt from "./ShipArt";

/**
 * Hide your fleet: pick a ship and tap where its bow goes (or drag ships
 * around), press R or "Turn" to stand it up, or Shuffle for a random fleet.
 * Ships can't touch, not even corner to corner. In Tactics (`mines` > 0) a
 * second step hides the mines on open water.
 */
export default function Placement({
  sea,
  fleetSkin,
  title = "Hide your fleet",
  doneLabel = "✓ Ready",
  busy = false,
  mines: mineCount = 0,
  onDone,
}: {
  sea: string;
  fleetSkin: string;
  title?: string;
  doneLabel?: string;
  busy?: boolean;
  /** Tactics: how many mines to hide after the ships. */
  mines?: number;
  onDone: (code: string) => void;
}) {
  const [step, setStep] = useState<"ships" | "mines">("ships");
  const [mines, setMines] = useState<number[]>([]);
  const [ships, setShips] = useState<(P | null)[]>(() => FLEET.map(() => null));
  const [selected, setSelected] = useState<number | null>(0);
  const [horizontal, setHorizontal] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const dragging = useRef<{ ship: number; from: number; offset: number } | null>(null);

  const placedAll = ships.every(Boolean);
  const error = placedAll ? validateFleet(ships) : null;

  /** The fleet with ship `i` at `bow` (or null if it leaves the grid). */
  function tryPut(i: number, bow: number, h = horizontal): (P | null)[] | null {
    const p = { bow, horizontal: h };
    if (!shipCells(p, FLEET[i].len)) return null;
    const next = [...ships];
    next[i] = p;
    return next;
  }

  const preview =
    selected !== null && hover !== null
      ? (() => {
          const cells = shipCells({ bow: hover, horizontal }, FLEET[selected].len);
          if (!cells) return { cells: [hover], ok: false };
          const next = tryPut(selected, hover);
          return { cells, ok: !!next && validateFleet(next, true) === null };
        })()
      : null;

  function place(cell: number) {
    const occ = occupancy(ships);
    // Tap a placed ship to pick it up again.
    if (occ[cell] !== -1) {
      pickUp(occ[cell]);
      return;
    }
    if (selected === null) return;
    const next = tryPut(selected, cell);
    if (!next) {
      setNote("That ship doesn't fit there. Try another square or turn it (R).");
      return;
    }
    const err = validateFleet(next, true);
    if (err) {
      setNote(err === "touching" ? "Ships can't touch, not even corner to corner." : "That spot is taken.");
      playSfx("whiff");
      return;
    }
    playSfx("drop");
    setShips(next);
    setNote(null);
    const free = next.findIndex((s) => s === null);
    setSelected(free === -1 ? null : free);
  }

  function pickUp(i: number) {
    const p = ships[i];
    const next = [...ships];
    next[i] = null;
    setShips(next);
    setSelected(i);
    if (p) setHorizontal(p.horizontal);
    playSfx("click");
  }

  // Drag: press on a placed ship and let go over another square to move it
  // there (a press and release on the same square is a tap: see `place`).
  const shipsRef = useRef(ships);
  shipsRef.current = ships;
  useEffect(() => {
    const up = (e: globalThis.PointerEvent) => {
      const d = dragging.current;
      dragging.current = null;
      if (!d) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-cell]");
      const to = el?.dataset.cell ? Number(el.dataset.cell) : null;
      if (to === null || to === d.from) return;
      const cur = shipsRef.current;
      const was = cur[d.ship];
      if (!was) return;
      const bow = to - d.offset;
      const next = [...cur];
      next[d.ship] = { bow, horizontal: was.horizontal };
      const sameRow = !was.horizontal || Math.floor(bow / 10) === Math.floor(to / 10);
      if (bow >= 0 && sameRow && shipCells(next[d.ship]!, FLEET[d.ship].len) && validateFleet(next, true) === null) {
        setShips(next);
        setNote(null);
        playSfx("drop");
      } else {
        setNote("It can't go there: ships can't overlap or touch.");
        playSfx("whiff");
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  /** Open water not next to a ship (where a mine may go). */
  const mineSpot = (cell: number, fleet = ships) => {
    const occ = occupancy(fleet);
    return occ[cell] === -1 && neighbours(cell).every((n) => occ[n] === -1);
  };

  function toggleMine(cell: number) {
    if (mines.includes(cell)) {
      setMines(mines.filter((m) => m !== cell));
      playSfx("click");
      return;
    }
    if (!mineSpot(cell)) {
      setNote("Mines go on open water, not on or next to a ship.");
      playSfx("whiff");
      return;
    }
    if (mines.length >= mineCount) {
      setNote(`You have ${mineCount} mines. Tap one to pick it up first.`);
      return;
    }
    setMines([...mines, cell]);
    setNote(null);
    playSfx("drop");
  }

  function shuffleMines() {
    const spots = Array.from({ length: 100 }, (_, c) => c).filter((c) => mineSpot(c));
    const picked: number[] = [];
    while (picked.length < mineCount && spots.length) picked.push(spots.splice(Math.floor(Math.random() * spots.length), 1)[0]);
    setMines(picked);
    setNote(null);
    playSfx("slide");
  }

  if (step === "mines") {
    const mineError = validateMines(ships, mines);
    return (
      <div className="sonar-placement">
        <div className="sonar-place-board">
          <Grid
            label={`${title}: hide your mines`}
            sea={sea}
            fleetSkin={fleetSkin}
            ships={shipsOf(ships)}
            mines={mines}
            interactive
            pickAll
            preview={hover !== null && !mines.includes(hover) ? { cells: [hover], ok: mineSpot(hover) } : null}
            onHover={setHover}
            onPick={toggleMine}
          />
        </div>
        <aside className="panel sonar-dock">
          <h3>💣 Hide {mineCount} mines</h3>
          <p className="hint">
            Tap open water (not next to a ship) to hide a mine; tap it again to pick it up. If the other side shoots one, one of their ship squares is
            shown to you.
          </p>
          <p>
            <strong>
              {mines.length}/{mineCount}
            </strong>{" "}
            mines hidden
          </p>
          <div className="game-controls">
            <button className="btn-sm btn-blue" onClick={shuffleMines}>
              🎲 Shuffle mines
            </button>
            <button className="btn-sm btn-ghost" onClick={() => setMines([])}>
              Clear
            </button>
          </div>
          {note && (
            <p className="error" role="alert">
              {note}
            </p>
          )}
          <button className="btn-green" disabled={mines.length !== mineCount || !!mineError || busy} onClick={() => onDone(fleetCode(ships as P[], mines))}>
            {busy ? "…" : doneLabel}
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              setStep("ships");
              setNote(null);
            }}
          >
            ← Back to the ships
          </button>
        </aside>
      </div>
    );
  }

  return (
    <div className="sonar-placement">
      <div className="sonar-place-board">
        <Grid
          label={`${title}: your grid`}
          sea={sea}
          fleetSkin={fleetSkin}
          ships={shipsOf(ships)}
          interactive
          preview={preview}
          onHover={setHover}
          onPick={place}
          onRotate={() => setHorizontal((h) => !h)}
          onCellPointerDown={(cell, e) => {
            const owner = occupancy(ships)[cell];
            if (owner !== -1 && e.button === 0) {
              // Keep the square you grabbed under your finger.
              dragging.current = { ship: owner, from: cell, offset: cell - ships[owner]!.bow };
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
            }
          }}
        />
      </div>
      <aside className="panel sonar-dock">
        <h3>{title}</h3>
        <p className="hint">Pick a ship, then tap where its front goes. Tap or drag a placed ship to move it. Ships can't touch, not even corner to corner.</p>
        <ul className="sonar-dock-ships">
          {FLEET.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`sonar-dock-ship${selected === i ? " selected" : ""}${ships[i] ? " placed" : ""}`}
                aria-pressed={selected === i}
                onClick={() => (ships[i] ? pickUp(i) : setSelected(i))}
              >
                <span className="sonar-dock-art" style={{ width: `${s.len * 18}px` }}>
                  <ShipArt len={s.len} horizontal skin={fleetSkin} />
                </span>
                <span>
                  {s.name} <small>({s.len})</small>
                </span>
                {ships[i] && <span aria-label="placed">✓</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="game-controls">
          <button className="btn-sm" onClick={() => setHorizontal((h) => !h)} title="R">
            ⟳ Turn ({horizontal ? "lying" : "standing"})
          </button>
          <button
            className="btn-sm btn-blue"
            onClick={() => {
              setShips(randomFleet());
              setSelected(null);
              setNote(null);
              playSfx("slide");
            }}
          >
            🎲 Shuffle
          </button>
          <button
            className="btn-sm btn-ghost"
            onClick={() => {
              setShips(FLEET.map(() => null));
              setSelected(0);
            }}
          >
            Clear
          </button>
        </div>
        {(note || error) && (
          <p className="error" role="alert">
            {note ?? (error ? FLEET_ERROR_TEXT[error] : "")}
          </p>
        )}
        <button
          className="btn-green"
          disabled={!placedAll || !!error || busy}
          onClick={() => {
            if (mineCount > 0) {
              // Mines that ended up next to a moved ship have to move too.
              setMines(mines.filter((m) => mineSpot(m)));
              setStep("mines");
              setNote(null);
            } else onDone(fleetCode(ships as P[]));
          }}
        >
          {busy ? "…" : mineCount > 0 ? "Next: hide mines →" : doneLabel}
        </button>
      </aside>
    </div>
  );
}
