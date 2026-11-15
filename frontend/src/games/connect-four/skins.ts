/** Chip skins. Ids/rarities must match backend/src/connect_four/skins.rs. */
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface SkinMeta {
  id: string;
  name: string;
  rarity: Rarity;
  free: boolean;
  /** Base fill (used by the wheel and as the chip body color). */
  color: string;
  /** Darker rim color. */
  rim: string;
}

export const SKINS: SkinMeta[] = [
  { id: "red", name: "Classic Red", rarity: "common", free: true, color: "#ff4d4f", rim: "#b81d24" },
  { id: "blue", name: "Classic Blue", rarity: "common", free: true, color: "#3a86ff", rim: "#1d4fb8" },
  { id: "green", name: "Lime Green", rarity: "common", free: false, color: "#3bce7a", rim: "#1f8f50" },
  { id: "purple", name: "Royal Purple", rarity: "rare", free: false, color: "#9b5de5", rim: "#5f2a9e" },
  { id: "golden", name: "Golden", rarity: "legendary", free: false, color: "#ffd23f", rim: "#c48a00" },
  { id: "red-bird", name: "Pip", rarity: "rare", free: false, color: "#ff6b35", rim: "#b2431c" },
  { id: "pig", name: "Gobbo", rarity: "rare", free: false, color: "#9d4edd", rim: "#5a189a" },
  { id: "bomb-bird", name: "Boomer", rarity: "epic", free: false, color: "#4b2a6b", rim: "#2a1640" },
  { id: "egg", name: "Golden Egg", rarity: "epic", free: false, color: "#fff1b8", rim: "#d9a400" },
  { id: "tnt", name: "TNT Crate", rarity: "epic", free: false, color: "#c8873a", rim: "#7a4a14" },
  { id: "ocean", name: "Ocean Teal", rarity: "common", free: true, color: "#2ec4b6", rim: "#16857b" },
  { id: "sunset", name: "Sunset Orange", rarity: "common", free: true, color: "#fb8500", rim: "#b35f00" },
  { id: "mint", name: "Mint", rarity: "common", free: true, color: "#8ee3c8", rim: "#3fa184" },
  { id: "night", name: "Night Sky", rarity: "common", free: true, color: "#3d348b", rim: "#221c55" },
];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#a9b1d6",
  rare: "#3a86ff",
  epic: "#9b5de5",
  legendary: "#ffd23f",
};

export function findSkin(id: string): SkinMeta {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/**
 * Pick the opponent's skin: never the same as yours, so the board stays
 * readable. Prefers `preferred` when it differs.
 */
export function opponentSkin(mine: string, preferred = "blue"): string {
  if (preferred !== mine) return preferred;
  return mine === "red" ? "blue" : "red";
}
