/**
 * Memory Match screen logic with no React or browser in it (so it can be
 * tested): the card deck, the power catalog, who is who, targets and the
 * line describing the last move. The rules themselves run on the server
 * (backend/src/memory/rules.rs).
 */
import raw from "../../../../shared/memory_powers.json";
import type { MemoryLast, MemoryRoomInfo } from "../../api/types";

export type Target = "none" | "two" | "block" | "row";

export interface PowerDef {
  id: string;
  name: string;
  icon: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  target: Target;
  text: string;
}

export const POWERS = raw.powers as PowerDef[];
export const KIT_SIZE = 3;
export const findPower = (id: string): PowerDef | undefined => POWERS.find((p) => p.id === id);

/** One symbol per pair (Large uses all 18). None look like a power icon. */
export const DECK = ["🍎", "🐟", "🌵", "🚀", "🎈", "🍄", "🌙", "⚡", "🎲", "🐙", "🍩", "🎸", "🌻", "🐝", "💎", "🦊", "🍉", "⭐"];
export const symbol = (s: number) => DECK[s] ?? "?";

export const SIZES = [
  { id: "small", label: "4×4", pairs: 8 },
  { id: "medium", label: "4×6", pairs: 12 },
  { id: "large", label: "6×6", pairs: 18 },
] as const;

/** Your player index in the rules' arrays (0 = whoever moved first). */
export const playerOf = (seat: 1 | 2, firstSeat: 1 | 2): 0 | 1 => (seat === firstSeat ? 0 : 1);

/** Board position shown at screen slot `slot` (Mirror flips each row). */
export function positionAt(slot: number, cols: number, mirrored: boolean): number {
  if (!mirrored) return slot;
  const row = Math.floor(slot / cols);
  return row * cols + (cols - 1 - (slot % cols));
}

/** The 2×2 block a tap picks (clamped so it fits), clockwise from its top-left. */
export function blockAt(pos: number, cols: number, rows: number): number[] {
  const c = Math.min(pos % cols, cols - 2);
  const r = Math.min(Math.floor(pos / cols), rows - 2);
  const tl = r * cols + c;
  return [tl, tl + 1, tl + cols + 1, tl + cols];
}

export const rowOf = (pos: number, cols: number) => Math.floor(pos / cols);

/** Cards still face down (not taken, not half-flipped). */
export const faceDown = (cells: number[]) => cells.flatMap((c, i) => (c === 0 ? [i] : []));

/**
 * The move code once a power has its targets, or null while more are
 * needed / the pick isn't allowed. `picked` are board positions.
 */
export function powerCode(p: PowerDef, picked: number[], info: Pick<MemoryRoomInfo, "cells" | "cols" | "rows">): string | null {
  const down = new Set(faceDown(info.cells));
  switch (p.target) {
    case "none":
      return p.id;
    case "two":
      return picked.length === 2 && picked[0] !== picked[1] && picked.every((i) => down.has(i)) ? `${p.id}:${picked[0]},${picked[1]}` : null;
    case "block": {
      if (picked.length !== 1) return null;
      const b = blockAt(picked[0], info.cols, info.rows);
      return b.filter((i) => info.cells[i] >= 0).length >= 2 ? `${p.id}:${b[0]}` : null;
    }
    case "row": {
      if (picked.length !== 1) return null;
      const r = rowOf(picked[0], info.cols);
      const any = Array.from({ length: info.cols }, (_, c) => r * info.cols + c).some((i) => info.cells[i] >= 0);
      return any ? `${p.id}:${r}` : null;
    }
  }
}

/** What a power asks you to tap. */
export function targetHint(p: PowerDef): string {
  switch (p.target) {
    case "none":
      return `Use ${p.name} now?`;
    case "two":
      return `Tap 2 face-down cards for ${p.name}.`;
    case "block":
      return `Tap a card to pick the 2×2 block ${p.name} turns.`;
    case "row":
      return `Tap any card in the row you want to ${p.name}.`;
  }
}

/** One line about the last move, from your side ("You", "Rival"). */
export function describeLast(last: MemoryLast | null | undefined, me: 0 | 1, rival: string): string | null {
  if (!last) return null;
  const who = last.player === me ? "You" : rival;
  const pair = last.cards.map(([, s]) => symbol(s)).join(" ");
  switch (last.kind) {
    case "flip":
      return null;
    case "match":
      return `${who} found a pair: ${pair}`;
    case "miss":
      return last.kept_turn ? `${who} missed (${pair}), but Second Chance keeps the turn` : `${who} missed: ${pair}`;
    case "power": {
      const p = last.power ? findPower(last.power) : undefined;
      if (!p) return `${who} used a power`;
      const where = last.spots.length ? ` on ${last.spots.length} card${last.spots.length === 1 ? "" : "s"}` : "";
      return `${who} used ${p.icon} ${p.name}${where}`;
    }
  }
}

/** Remembered kit: keep only powers that exist and that you own. */
export function usableKit(saved: string[], owns: (id: string) => boolean): string[] {
  const seen = new Set<string>();
  return saved.filter((id) => findPower(id) && owns(id) && !seen.has(id) && (seen.add(id), true)).slice(0, KIT_SIZE);
}

/** Toggle a power in a kit being picked (at most 3; a 4th pick is refused). */
export function toggleKit(kit: string[], id: string): string[] {
  if (kit.includes(id)) return kit.filter((k) => k !== id);
  return kit.length >= KIT_SIZE ? kit : [...kit, id];
}
