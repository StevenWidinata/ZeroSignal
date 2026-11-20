import type { SonarLogEntry, SonarPowers, SonarSea } from "../../api/types";
import { FLEET, lineCells, markChar, parseFleet, parseMove, shipCells, torpedoPath, type Duel, type Placement, type Sea, type Turn } from "./rules";
import { ITEMS, POWERS } from "./tactics";

export interface DrawnShip {
  ship: number;
  cells: number[];
}

/** The ships of a fleet code (or placements) as cell lists, for drawing. */
export function shipsOf(fleet: string | (Placement | null)[] | null | undefined): DrawnShip[] {
  if (!fleet) return [];
  let ships: (Placement | null)[];
  if (typeof fleet === "string") {
    const f = parseFleet(fleet);
    if ("error" in f) return [];
    ships = f.ships;
  } else ships = fleet;
  const out: DrawnShip[] = [];
  ships.forEach((p, i) => {
    const cells = p && shipCells(p, FLEET[i].len);
    if (cells) out.push({ ship: i, cells });
  });
  return out;
}

/** "Hit!", "Miss", "Sunk their Cruiser!", "Ping: 3 ship squares nearby", "Radar: 2 ship squares in that line". */
export function resultText(r: { kind: string; ship?: number; count?: number; item?: string; power?: number }, whose: "their" | "your" = "their"): string {
  const squares = `${r.count} ship square${r.count === 1 ? "" : "s"}`;
  if (r.kind === "miss") return "Miss";
  if (r.kind === "hit") return "Hit!";
  if (r.kind === "sunk") return `Sunk ${whose} ${FLEET[r.ship ?? 0].name}!`;
  if (r.kind === "radar") return `Radar: ${squares} in that line`;
  if (r.kind === "seen") return "Flare: ship spotted!";
  if (r.kind === "clear") return "Flare: only water";
  if (r.kind === "dud") return "Torpedo ran off the edge";
  if (r.kind === "mine") return "Boom, a mine! One of the shooter's ships is now spotted";
  if (r.kind === "mine_seen") return "Flare: a mine (now harmless)";
  if (r.kind === "crate") {
    const item = ITEMS.find((i) => i.id === r.item);
    return `Supply crate: ${item ? `${item.icon} ${item.name}` : "a prize"}!`;
  }
  if (r.kind === "crate_seen") return "Flare: a supply crate";
  if (r.kind === "blocked") return "Blocked by a shield (a ship is there)";
  if (r.kind === "exposed") return "A ship square was spotted";
  if (r.kind === "repaired") return "Repaired a hit square";
  if (r.kind === "charged") return `Overdrive: ${POWERS[r.power ?? 0].name} is charged`;
  return `Ping: ${squares} nearby`;
}

/** "C7" for cell 62 (upper case for display). */
export const label = (cell: number) => `${String.fromCharCode(65 + (cell % 10))}${Math.floor(cell / 10) + 1}`;

/** A browser-side Sea (same-device games) in the server's view shape. */
export function viewOf(sea: Sea): SonarSea {
  const sunk: { ship: number; cells: number[] }[] = [];
  const marks = sea.marks
    .map((m, cell) => {
      if (typeof m === "object") {
        const s = sunk.find((x) => x.ship === m.sunk);
        if (s) s.cells.push(cell);
        else sunk.push({ ship: m.sunk, cells: [cell] });
        return "s";
      }
      return markChar(m);
    })
    .join("");
  return {
    marks,
    sunk,
    pings: [...sea.pings],
    pings_left: sea.pingsLeft(),
    shots: sea.moves.length,
    all_sunk: sea.allSunk(),
    sweeps: [...sea.sweeps],
    shields: sea.shields,
  };
}

/** A browser-side duel's powers for `side`, in the server's view shape (null for Classic). */
export function powersOf(d: Duel, side: 0 | 1): SonarPowers | null {
  const t = d.tactics;
  if (!t) return null;
  return {
    charge: [...t.charge[side]],
    cooldown: POWERS.map((_, p) => t.spec(side, p).cooldown),
    size: POWERS.map((_, p) => t.spec(side, p).size),
    levels: [...t.levels[side]],
    lost: POWERS.map((_, p) => d.seas[side].isSunk(p)),
    combo: t.combo[side],
    overdrive: t.overdrive[side],
  };
}

/** A browser-side turn as a log entry (seen by `viewer`). */
export function entryOf(t: Turn, viewer: 0 | 1, code: string): SonarLogEntry {
  const cells = (v: [number, Turn["result"]][]) => v.map(([cell, result]) => ({ cell, result }));
  return { mine: t.side === viewer, move: code, cell: t.results[0]?.[0] ?? 0, ping: t.move.kind === "ping", result: t.result, hits: cells(t.results), own: cells(t.own) };
}

const EDGE_NAME = { l: "the left", r: "the right", u: "the top", d: "the bottom" } as const;

/** What a move was, e.g. "fired at C7", "called an ✈️ Air Strike on B4–D4". */
function moveWords(e: SonarLogEntry): string {
  const m = parseMove(e.move);
  if (!m) return e.ping ? `pinged ${label(e.cell)}` : `fired at ${label(e.cell)}`;
  const span = (cells: number[]) => (cells.length > 1 ? `${label(cells[0])}–${label(cells[cells.length - 1])}` : label(cells[0] ?? e.cell));
  switch (m.kind) {
    case "fire":
      return `fired at ${label(m.cell)}`;
    case "ping":
      return `pinged ${label(m.cell)}`;
    case "air_strike":
      return `called an ✈️ Air Strike on ${span(e.hits.map((h) => h.cell))}`;
    case "salvo":
      return `fired a 💥 Salvo at ${m.cells.map(label).join(", ")}`;
    case "radar":
      return `swept ${m.row ? `row ${m.line + 1}` : `column ${String.fromCharCode(65 + m.line)}`} with 📶 Radar`;
    case "torpedo":
      return `fired a 🚀 Torpedo from ${EDGE_NAME[m.edge]} along ${m.edge === "l" || m.edge === "r" ? `row ${m.line + 1}` : `column ${String.fromCharCode(65 + m.line)}`}`;
    case "flare":
      return `lit a 🎆 Flare over ${label(m.cell)}`;
    case "overdrive":
      return `used ⚡ Overdrive`;
  }
}

/** What a move did, in words ("Hit!", "2 hits and a miss", "Sunk their Cruiser!"). */
function resultWords(e: SonarLogEntry, whose: "their" | "your"): string {
  if (e.hits.length <= 1) return resultText(e.result, whose);
  const n = (kind: string) => e.hits.filter((h) => h.result.kind === kind).length;
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  for (const h of e.hits) if (["sunk", "crate", "mine", "blocked"].includes(h.result.kind)) parts.push(resultText(h.result, whose));
  if (n("hit")) parts.push(plural(n("hit"), "hit"));
  if (n("seen")) parts.push(`${plural(n("seen"), "ship square")} spotted`);
  if (n("crate_seen")) parts.push(plural(n("crate_seen"), "crate") + " seen");
  if (n("mine_seen")) parts.push(plural(n("mine_seen"), "mine") + " seen");
  if (n("miss")) parts.push(plural(n("miss"), "miss", "misses"));
  if (n("clear")) parts.push(`${n("clear")} water`);
  return parts.join(" · ") || resultText(e.result, whose);
}

/**
 * A whole move for the status bar: "You called an ✈️ Air Strike on B4–D4: 2
 * hits · 1 miss". `who` is "You" or a name; `whose` is whose ships they hit.
 */
export function describe(e: SonarLogEntry, who: string, whose: "their" | "your"): string {
  let text = `${who} ${moveWords(e)}: ${resultWords(e, whose)}`;
  for (const o of e.own) {
    if (o.result.kind === "exposed") text += ` · the mine showed one of ${who === "You" ? "your" : "their"} ships!`;
    if (o.result.kind === "repaired") text += " · 🔧 repaired a hit square";
  }
  return text;
}

/** A short effect to play on a grid after a move. */
export interface Fx {
  kind: "boom" | "splash" | "sweep" | "trail" | "flare" | "strike";
  cells: number[];
}

/** The effects a move shows on the sea it was aimed at. */
export function fxFor(e: SonarLogEntry): Fx[] {
  const m = parseMove(e.move);
  const out: Fx[] = [];
  if (m?.kind === "radar") out.push({ kind: "sweep", cells: lineCells(m.line, m.row) });
  if (m?.kind === "torpedo") {
    const path = torpedoPath(m.line, m.edge);
    const end = e.hits[0] ? path.indexOf(e.hits[0].cell) : -1;
    out.push({ kind: "trail", cells: end === -1 ? path : path.slice(0, end + 1) });
  }
  if (m?.kind === "flare") out.push({ kind: "flare", cells: e.hits.map((h) => h.cell) });
  if (m?.kind === "air_strike") out.push({ kind: "strike", cells: e.hits.map((h) => h.cell) });
  for (const h of e.hits) {
    const k = h.result.kind;
    if (k === "hit" || k === "sunk" || k === "mine" || k === "blocked") out.push({ kind: "boom", cells: [h.cell] });
    else if (k === "miss" || k === "crate") out.push({ kind: "splash", cells: [h.cell] });
  }
  return out;
}
