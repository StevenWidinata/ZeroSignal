/**
 * Signal Flap drones, trails and skies (shared/flap_items.json). The server
 * decides ownership and prices; this file only knows how they look.
 */
import raw from "../../../../shared/flap_items.json";
import type { FlapItemKind } from "../../api/types";

export interface DroneArt {
  style: "round" | "box" | "pixel" | "kite" | "wing" | "prism" | "beacon";
  body: string;
  rotor: string;
  /** The little status light. */
  light: string;
}
export interface TrailArt {
  style: "none" | "waves" | "sparks" | "dots" | "static" | "bubbles" | "stars" | "comet";
  color: string;
}
export interface SkyArt {
  style: "plain" | "city" | "grid" | "scan" | "sun" | "synth" | "aurora" | "space";
  top: string;
  bottom: string;
  tower: string;
  /** Tower lights, signal bars and other details. */
  accent: string;
  ground: string;
}

export interface Item<A> {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  art: A;
}

export const DRONES = raw.drones as Item<DroneArt>[];
export const TRAILS = raw.trails as Item<TrailArt>[];
export const SKIES = raw.skies as Item<SkyArt>[];

export const LISTS = { drone: DRONES, trail: TRAILS, sky: SKIES } as const;

export const findDrone = (id: string) => DRONES.find((s) => s.id === id) ?? DRONES[0];
export const findTrail = (id: string) => TRAILS.find((s) => s.id === id) ?? TRAILS[0];
export const findSky = (id: string) => SKIES.find((s) => s.id === id) ?? SKIES[0];

/** "trail:comet" → "Comet Tail trail". */
export function itemName(key: string): string {
  const [kind, id] = key.split(":") as [FlapItemKind, string];
  const it = (LISTS[kind] as Item<unknown>[] | undefined)?.find((i) => i.id === id);
  return it ? `${it.name} ${kind}` : key;
}

export const isItem = (kind: FlapItemKind, id: string) => (LISTS[kind] as Item<unknown>[]).some((i) => i.id === id);
