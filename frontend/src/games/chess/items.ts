/**
 * Board styles and piece sets: the same JSON the backend uses
 * (shared/chess_items.json). The server decides ownership and prices.
 */
import raw from "../../../../shared/chess_items.json";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface BoardArt {
  light: string;
  dark: string;
  border: string;
  /** Extra texture drawn with CSS. */
  style: "plain" | "wood" | "marble" | "candy" | "pixel" | "neon" | "gold";
}

export type PieceArt =
  | { kind: "glyph"; style: "classic" | "outline" | "neon" | "candy" }
  | { kind: "pixel" }
  | { kind: "emoji"; k: string; q: string; r: string; b: string; n: string; p: string };

export interface ChessItem<A> {
  id: string;
  name: string;
  rarity: Rarity;
  price: number | null;
  art: A;
}

export const BOARDS = raw.boards as ChessItem<BoardArt>[];
export const PIECE_SETS = raw.pieces as ChessItem<PieceArt>[];

export const findBoard = (id: string) => BOARDS.find((b) => b.id === id) ?? BOARDS[0];
export const findPieces = (id: string) => PIECE_SETS.find((p) => p.id === id) ?? PIECE_SETS[0];

/** "board:neon" → its name, for lucky-drop messages. */
export function itemName(key: string): string {
  const [kind, id] = key.split(":");
  return (kind === "board" ? BOARDS.find((b) => b.id === id) : PIECE_SETS.find((p) => p.id === id))?.name ?? id;
}
