import type { ReactNode } from "react";
import { findFleet, type FleetArt } from "./items";

/**
 * One ship drawn in code, `len` squares long. Drawn lying down (bow on the
 * left) and turned for standing ships, so every look works both ways.
 */
function hull(a: FleetArt, L: number): ReactNode {
  const W = L * 10;
  switch (a.style) {
    case "sub":
      return (
        <>
          <rect x="1" y="2.5" width={W - 2} height="5" rx="2.5" fill={a.hull} stroke={a.accent} strokeWidth="0.6" />
          <rect x={W / 2 - 3} y="0.8" width="6" height="3" rx="1" fill={a.deck} stroke={a.accent} strokeWidth="0.5" />
          {Array.from({ length: L }, (_, i) => (
            <circle key={i} cx={i * 10 + 5} cy="5" r="1" fill={a.accent} opacity="0.7" />
          ))}
        </>
      );
    case "pixel":
      return (
        <g shapeRendering="crispEdges">
          <rect x="1" y="3" width={W - 2} height="5" fill={a.hull} />
          <rect x="3" y="2" width={W - 6} height="1" fill={a.deck} />
          {Array.from({ length: L }, (_, i) => (
            <rect key={i} x={i * 10 + 3.5} y="0.5" width="3" height="2" fill={a.accent} />
          ))}
          <rect x="1" y="7" width={W - 2} height="1" fill="#000" opacity="0.35" />
        </g>
      );
    case "emoji":
      return (
        <>
          <rect x="1" y="2" width={W - 2} height="6" rx="3" fill={a.hull} stroke={a.accent} strokeWidth="0.7" />
          {Array.from({ length: L }, (_, i) => (
            <text key={i} x={i * 10 + 5} y="5.6" textAnchor="middle" dominantBaseline="middle" fontSize="6.5">
              {a.icon}
            </text>
          ))}
        </>
      );
    default: {
      // Navy, pirate, candy, neon: a pointed bow, a deck and gun turrets.
      const body = `M1.5 5 L7 1.8 H${W - 3} Q${W - 0.8} 1.8 ${W - 0.8} 5 Q${W - 0.8} 8.2 ${W - 3} 8.2 H7 Z`;
      return (
        <>
          <path d={body} fill={a.hull} stroke={a.style === "neon" ? a.accent : "rgba(0,0,0,0.45)"} strokeWidth={a.style === "neon" ? 0.8 : 0.5} />
          <rect x="8" y="3.4" width={W - 13} height="3.2" rx="1" fill={a.deck} />
          {a.style === "candy" &&
            Array.from({ length: L * 2 }, (_, i) => <rect key={i} x={6 + i * 5} y="1.8" width="2" height="6.4" fill={a.accent} opacity="0.55" />)}
          {Array.from({ length: L - 1 }, (_, i) =>
            a.style === "pirate" ? (
              <path key={i} d={`M${i * 10 + 12} 5 V-1 L${i * 10 + 17} 4 Z`} fill={a.accent} stroke="rgba(0,0,0,0.4)" strokeWidth="0.3" />
            ) : (
              <circle key={i} cx={i * 10 + 12} cy="5" r="1.4" fill={a.accent} />
            ),
          )}
        </>
      );
    }
  }
}

export default function ShipArt({ len, horizontal, skin, sunk = false }: { len: number; horizontal: boolean; skin: string; sunk?: boolean }) {
  const a = findFleet(skin).art;
  const W = len * 10;
  const glow = a.style === "neon" && !sunk ? { filter: `drop-shadow(0 0 2px ${a.accent})` } : undefined;
  return (
    <svg
      className={`sonar-ship-art${sunk ? " sunk" : ""}`}
      viewBox={horizontal ? `0 -1 ${W} 11` : `-1 0 11 ${W}`}
      preserveAspectRatio="none"
      style={glow}
      aria-hidden="true"
    >
      <g transform={horizontal ? undefined : "translate(10 0) rotate(90)"}>{hull(a, len)}</g>
    </svg>
  );
}
