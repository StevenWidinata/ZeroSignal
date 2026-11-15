import type { SnakeMode, SnakeSize } from "../../api/types";
import type { End } from "./engine";

export const END_TEXT: Record<End, string> = {
  wall: "Hit the wall",
  self: "Bit your own tail",
  glitch: "Hit a glitch block",
  bug: "Caught by the glitch bug",
  signal: "Signal lost",
  full: "Board full!",
  time: "Time cap reached",
  quit: "You ended the run",
};

export const MODE_INFO: Record<SnakeMode, { icon: string; name: string; blurb: string }> = {
  classic: { icon: "🧱", name: "Classic", blurb: "Walls all around. Grow long, stay fast, don't crash." },
  wrap: { icon: "🌀", name: "Wrap", blurb: "No walls: leave one edge and come back on the other side." },
  daily: { icon: "📅", name: "Daily", blurb: "Same board for everyone today. One ranked try." },
};

export const SIZE_INFO: Record<SnakeSize, { name: string; cells: number; note: string }> = {
  small: { name: "Small", cells: 15, note: "15×15, tight and risky: points ×1.3" },
  medium: { name: "Medium", cells: 20, note: "20×20, the standard board: points ×1" },
  large: { name: "Large", cells: 26, note: "26×26, room to roam: points ×0.85" },
};

export interface Prefs {
  mode: SnakeMode;
  size: SnakeSize;
  dpad: boolean;
  skin: string;
  arena: string;
  trail: string;
}

const PREFS_KEY = "zerosignal_snake_prefs";
export const DEFAULT_PREFS: Prefs = { mode: "classic", size: "medium", dpad: false, skin: "neon", arena: "grid", trail: "none" };

export function loadPrefs(isValid: (kind: "skin" | "arena" | "trail", id: string) => boolean): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!v) return DEFAULT_PREFS;
    return {
      mode: v.mode && v.mode in MODE_INFO ? v.mode : DEFAULT_PREFS.mode,
      size: v.size && v.size in SIZE_INFO ? v.size : DEFAULT_PREFS.size,
      dpad: v.dpad === true,
      skin: v.skin && isValid("skin", v.skin) ? v.skin : DEFAULT_PREFS.skin,
      arena: v.arena && isValid("arena", v.arena) ? v.arena : DEFAULT_PREFS.arena,
      trail: v.trail && isValid("trail", v.trail) ? v.trail : DEFAULT_PREFS.trail,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage may be blocked */
  }
}
