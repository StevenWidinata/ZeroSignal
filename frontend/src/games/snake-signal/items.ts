/**
 * Snake Signal skins, arenas and trails (shared/snake_items.json). The
 * server decides ownership and prices; this file only knows how they look.
 */
import raw from "../../../../shared/snake_items.json";

export interface SkinArt {
  style: "solid" | "circuit" | "pixel" | "ghost" | "rainbow" | "stripes";
  head: string;
  body: string;
  glow: string;
  stripe?: string;
}
export interface ArenaArt {
  style: "grid" | "dots" | "horizon" | "checker" | "stars" | "circuit";
  bg: string;
  line: string;
  wall: string;
  food: string;
}
export interface TrailArt {
  style: "none" | "sparks" | "bubbles" | "glitch" | "stars" | "comet";
  color: string;
}

interface Item<A> {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  art: A;
}

export const SKINS = raw.skins as Item<SkinArt>[];
export const ARENAS = raw.arenas as Item<ArenaArt>[];
export const TRAILS = raw.trails as Item<TrailArt>[];

export const findSkin = (id: string) => SKINS.find((s) => s.id === id) ?? SKINS[0];
export const findArena = (id: string) => ARENAS.find((s) => s.id === id) ?? ARENAS[0];
export const findTrail = (id: string) => TRAILS.find((s) => s.id === id) ?? TRAILS[0];

/** "skin:lava" → "Lava Line skin". */
export function itemName(key: string): string {
  const [kind, id] = key.split(":");
  const list = kind === "skin" ? SKINS : kind === "arena" ? ARENAS : TRAILS;
  const it = list.find((i) => i.id === id);
  return it ? `${it.name} ${kind}` : key;
}
