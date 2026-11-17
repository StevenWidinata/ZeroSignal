/**
 * Checkers boards and piece sets: the same JSON the backend uses
 * (shared/checkers_items.json). The server decides ownership and prices.
 */
import raw from "../../../../shared/checkers_items.json";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface BoardArt {
  style: "flat" | "wood" | "marble" | "neon" | "royal";
  light: string;
  dark: string;
  border: string;
}

export interface PieceArt {
  style: "disc" | "coin" | "button" | "gem" | "pixel" | "emoji";
  dark: string;
  light: string;
  rim: string;
  crown: string;
  darkIcon?: string;
  lightIcon?: string;
}

export interface CheckersItem<A> {
  id: string;
  name: string;
  rarity: Rarity;
  price: number | null;
  art: A;
}

export const BOARDS = raw.boards as CheckersItem<BoardArt>[];
export const PIECE_SETS = raw.pieces as CheckersItem<PieceArt>[];

export const findBoard = (id: string) => BOARDS.find((b) => b.id === id) ?? BOARDS[0];
export const findPieces = (id: string) => PIECE_SETS.find((p) => p.id === id) ?? PIECE_SETS[0];

/** "board:neon" → its name, for lucky-drop messages. */
export function itemName(key: string): string {
  const [kind, id] = key.split(":");
  return (kind === "board" ? BOARDS.find((b) => b.id === id) : PIECE_SETS.find((p) => p.id === id))?.name ?? id;
}
