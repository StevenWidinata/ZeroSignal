/**
 * Fleet looks and sea themes: the same JSON the backend uses
 * (shared/sonar_items.json). The server decides ownership and prices.
 */
import raw from "../../../../shared/sonar_items.json";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface FleetArt {
  style: "navy" | "sub" | "emoji" | "pixel" | "pirate" | "candy" | "neon";
  hull: string;
  deck: string;
  accent: string;
  icon?: string;
}

export interface SeaArt {
  style: "waves" | "ice" | "plain" | "lava" | "stars" | "gold";
  water: string;
  deep: string;
  line: string;
}

export interface SonarItem<A> {
  id: string;
  name: string;
  rarity: Rarity;
  price: number | null;
  art: A;
}

export const FLEETS = raw.fleets as SonarItem<FleetArt>[];
export const SEAS = raw.seas as SonarItem<SeaArt>[];

export const findFleet = (id: string) => FLEETS.find((f) => f.id === id) ?? FLEETS[0];
export const findSea = (id: string) => SEAS.find((s) => s.id === id) ?? SEAS[0];

/** "sea:lava" → its name, for lucky-drop messages. */
export function itemName(key: string): string {
  const [kind, id] = key.split(":");
  return (kind === "fleet" ? FLEETS.find((f) => f.id === id) : SEAS.find((s) => s.id === id))?.name ?? id;
}
