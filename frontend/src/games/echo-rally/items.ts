/**
 * Echo Rally powers, paddles, balls and courts (shared/rally_items.json). The
 * server decides ownership and prices; this file only knows names, texts and
 * how the cosmetics look.
 */
import raw from "../../../../shared/rally_items.json";
import type { RallyCollection, RallyItemKind } from "../../api/types";
import type { Power } from "./engine";

export interface PaddleArt {
  style: "solid" | "neon" | "chrome" | "laser" | "crystal" | "gold";
  color: string;
  edge: string;
}
export interface BallArt {
  style: "square" | "round" | "bat" | "fire" | "plasma" | "comet" | "rings";
  color: string;
  /** A colour, or "none". */
  glow: string;
}
export interface CourtArt {
  style: "plain" | "grid" | "scan" | "synth" | "cabinet" | "stadium" | "space";
  bg: string;
  line: string;
  net: string;
  /** Score digits, echo rings and other details. */
  accent: string;
}

export interface Item<A> {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  art: A;
}

export interface PowerItem {
  id: Power;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  text: string;
}

export const POWER_ITEMS = raw.powers as PowerItem[];
export const PADDLES = raw.paddles as Item<PaddleArt>[];
export const BALLS = raw.balls as Item<BallArt>[];
export const COURTS = raw.courts as Item<CourtArt>[];

export type CosmeticKind = Exclude<RallyItemKind, "power">;
export const LISTS = { paddle: PADDLES, ball: BALLS, court: COURTS } as const;

export const findPower = (id: string): PowerItem => POWER_ITEMS.find((p) => p.id === id) ?? POWER_ITEMS[0];
export const findPaddle = (id: string) => PADDLES.find((s) => s.id === id) ?? PADDLES[0];
export const findBall = (id: string) => BALLS.find((s) => s.id === id) ?? BALLS[0];
export const findCourt = (id: string) => COURTS.find((s) => s.id === id) ?? COURTS[0];

export const isItem = (kind: CosmeticKind, id: string) => (LISTS[kind] as Item<unknown>[]).some((i) => i.id === id);
export const isPower = (id: string): id is Power => POWER_ITEMS.some((p) => p.id === id);

/** "ball:comet" → "Comet ball". */
export function itemName(key: string): string {
  const [kind, id] = key.split(":") as [RallyItemKind, string];
  if (kind === "power") return `${findPower(id).name} power`;
  const it = (LISTS[kind] as Item<unknown>[] | undefined)?.find((i) => i.id === id);
  return it ? `${it.name} ${kind}` : key;
}

/** Free, or owned according to the server (before it answers: only the free ones). */
export function owns(collection: RallyCollection | null, kind: RallyItemKind, id: string): boolean {
  const list =
    kind === "power" ? collection?.powers : kind === "paddle" ? collection?.paddles : kind === "ball" ? collection?.balls : collection?.courts;
  const found = list?.find((i) => i.id === id);
  if (found) return found.owned;
  const price = kind === "power" ? POWER_ITEMS.find((p) => p.id === id)?.price : (LISTS[kind] as Item<unknown>[]).find((i) => i.id === id)?.price;
  return price === null;
}
