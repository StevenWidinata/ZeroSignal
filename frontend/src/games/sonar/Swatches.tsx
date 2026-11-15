import { findSea } from "./items";
import ShipArt from "./ShipArt";

/** A small square of a sea theme. */
export function SeaSwatch({ id, size = 44 }: { id: string; size?: number }) {
  const a = findSea(id).art;
  return (
    <span
      className={`sonar-swatch sea-${a.style}`}
      style={{ width: size, height: size, borderColor: a.line, background: `linear-gradient(${a.water}, ${a.deep})` }}
      aria-hidden="true"
    />
  );
}

/** A little ship in a fleet look. */
export function FleetSwatch({ id, size = 44 }: { id: string; size?: number }) {
  return (
    <span className="sonar-fleet-swatch" style={{ width: size, height: size }} aria-hidden="true">
      <span style={{ display: "flex", width: "100%", height: size * 0.32 }}>
        <ShipArt len={3} horizontal skin={id} />
      </span>
    </span>
  );
}
