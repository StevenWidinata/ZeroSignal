import type { GameModule, PlayStyle } from "./types";

/** Hub filter: games you can play with a friend (online or on one device), games you play on your own, or every game. */
export type PlayFilter = "all" | "online" | "offline";

export interface PlayStyleInfo {
  id: PlayStyle;
  /** Filter chip text. */
  label: string;
  /** Card badge text (short). */
  badge: string;
  icon: string;
  /** One line explaining it (chip and badge tooltip). */
  hint: string;
}

/** In display order. Each has an icon and a word, never colour alone. */
export const PLAY_STYLES: PlayStyleInfo[] = [
  { id: "solo", label: "Solo", badge: "Solo", icon: "👤", hint: "Play on your own and chase a high score." },
  { id: "bot", label: "Vs Zero-Bot", badge: "Zero-Bot", icon: "🤖", hint: "Play against the computer at your level." },
  {
    id: "online",
    label: "Online",
    badge: "Online",
    icon: "🌐",
    hint: "Play a friend on another device (phone, tablet or PC) with a room code.",
  },
  { id: "local", label: "Same device", badge: "2P", icon: "👥", hint: "Two players take turns on one device." },
  { id: "daily", label: "Daily", badge: "Daily", icon: "📅", hint: "A new challenge every day, the same for everyone." },
];

export interface FilterInfo {
  id: Exclude<PlayFilter, "all">;
  label: string;
  icon: string;
  hint: string;
}

/** The Hub chips after "All games". Every game with Online also has Same device, so they are one group. */
export const FILTERS: FilterInfo[] = [
  { id: "online", label: "Online", icon: "🌐", hint: "Play a friend, on another device or the same one." },
  { id: "offline", label: "Offline", icon: "👤", hint: "Play on your own." },
];

export const PLAY_FILTERS: PlayFilter[] = ["all", ...FILTERS.map((f) => f.id)];

export const filterInfo = (id: PlayFilter): FilterInfo | null => FILTERS.find((f) => f.id === id) ?? null;

export const playInfo = (id: PlayStyle): PlayStyleInfo => PLAY_STYLES.find((p) => p.id === id) ?? PLAY_STYLES[0];

export function filterGames(games: GameModule[], f: PlayFilter): GameModule[] {
  if (f === "all") return games;
  const online = (g: GameModule) => g.meta.play.includes("online");
  return games.filter((g) => (f === "online" ? online(g) : !online(g)));
}

export function countBy(games: GameModule[], f: PlayFilter): number {
  return filterGames(games, f).length;
}

/** A game's styles in the same order as the chips. */
export function sortedStyles(play: PlayStyle[]): PlayStyle[] {
  return PLAY_STYLES.map((p) => p.id).filter((id) => play.includes(id));
}

const KEY = "zerosignal_hub_filter";

export function loadFilter(): PlayFilter {
  try {
    const v = localStorage.getItem(KEY);
    return v && (PLAY_FILTERS as string[]).includes(v) ? (v as PlayFilter) : "all";
  } catch {
    return "all";
  }
}

export function saveFilter(f: PlayFilter): void {
  try {
    localStorage.setItem(KEY, f);
  } catch {
    /* storage may be blocked */
  }
}
