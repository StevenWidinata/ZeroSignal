/**
 * Brick Breaker paddles, balls, brick themes and backdrops
 * (shared/brick_items.json). The server decides ownership and prices; this
 * file only knows how they look.
 */
import raw from "../../../../shared/brick_items.json";
import type { BrickItemKind } from "../../api/types";

export interface PaddleArt {
  style: "solid" | "neon" | "wood" | "pixel" | "metal" | "glass";
  color: string;
  edge: string;
}
export interface BallArt {
  style: "solid" | "ring" | "pixel" | "swirl" | "facets" | "tail" | "rays";
  color: string;
  edge: string;
}
export interface ThemeArt {
  style: "flat" | "pixel" | "stripes" | "glass" | "rock" | "metal";
  /** One color per brick row, repeating. */
  rows: string[];
  tough: string;
  steel: string;
  explosive: string;
  glow?: string;
}
export interface BackdropArt {
  style: "plain" | "grid" | "dots" | "horizon" | "stars" | "aurora" | "circuit";
  bg: string;
  line: string;
  wall: string;
}

export interface Item<A> {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  art: A;
}

export const PADDLES = raw.paddles as Item<PaddleArt>[];
export const BALLS = raw.balls as Item<BallArt>[];
export const THEMES = raw.themes as Item<ThemeArt>[];
export const BACKDROPS = raw.backdrops as Item<BackdropArt>[];

export const LISTS = { paddle: PADDLES, ball: BALLS, theme: THEMES, backdrop: BACKDROPS } as const;

export const findPaddle = (id: string) => PADDLES.find((s) => s.id === id) ?? PADDLES[0];
export const findBall = (id: string) => BALLS.find((s) => s.id === id) ?? BALLS[0];
export const findTheme = (id: string) => THEMES.find((s) => s.id === id) ?? THEMES[0];
export const findBackdrop = (id: string) => BACKDROPS.find((s) => s.id === id) ?? BACKDROPS[0];

const NOUN: Record<BrickItemKind, string> = { paddle: "paddle", ball: "ball", theme: "brick theme", backdrop: "backdrop" };

/** "ball:comet" → "Comet ball". */
export function itemName(key: string): string {
  const [kind, id] = key.split(":") as [BrickItemKind, string];
  const it = (LISTS[kind] as Item<unknown>[] | undefined)?.find((i) => i.id === id);
  return it ? `${it.name} ${NOUN[kind]}` : key;
}

export const isItem = (kind: BrickItemKind, id: string) => (LISTS[kind] as Item<unknown>[]).some((i) => i.id === id);
