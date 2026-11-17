import type { CSSProperties } from "react";
import { findPieces } from "./items";

/**
 * One checker. `value`: ±1 man, ±2 king (+ = dark). Dark and light differ in
 * colour AND shape (light pieces have a ring inside), kings wear a crown,
 * so colourblind players can tell them apart too.
 */
export default function Piece({ value, set, size }: { value: number; set: string; size?: number }) {
  const art = findPieces(set).art;
  const dark = value > 0;
  const king = Math.abs(value) === 2;
  const style = {
    "--pc-fill": dark ? art.dark : art.light,
    "--pc-rim": art.rim,
    "--pc-crown": art.crown,
    ...(size ? { width: size, height: size } : {}),
  } as CSSProperties;
  const icon = art.style === "emoji" ? (dark ? art.darkIcon : art.lightIcon) : null;
  return (
    <span className={`ck-piece pc-${art.style} ${dark ? "pc-dark" : "pc-light"}${king ? " pc-king" : ""}`} style={style} aria-hidden="true">
      {icon && <span className="pc-icon">{icon}</span>}
      {king && <span className="pc-crown">♛</span>}
    </span>
  );
}
