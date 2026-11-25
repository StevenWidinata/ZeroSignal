import type { BrickItemKind, BrickMode } from "../../api/types";
import type { Drop, End } from "./engine";

export const END_TEXT: Record<End, string> = {
  clear: "Level cleared",
  out: "Out of lives",
  time: "Time cap reached",
  quit: "You ended the run",
};

export const MODE_INFO: Record<BrickMode, { name: string; blurb: string }> = {
  campaign: { name: "Campaign", blurb: "24 levels in two worlds. Clear one to open the next, keep lives for stars." },
  endless: { name: "Endless", blurb: "Clear a wall and a tougher one drops in. How many waves can you last?" },
  daily: { name: "Daily", blurb: "Today's waves and drops, the same for everyone. One ranked try." },
};

/** The six drops: name, the letter on the capsule, its color and what it does. */
export const DROP_INFO: Record<Drop, { name: string; letter: string; color: string; text: string }> = {
  wide: { name: "Wide", letter: "W", color: "#3E8BD9", text: "A longer paddle for 15 seconds" },
  multi: { name: "Multi-ball", letter: "M", color: "#8E6CD9", text: "Two more balls" },
  slow: { name: "Slow", letter: "S", color: "#46A758", text: "Balls move slower for 10 seconds" },
  life: { name: "Extra life", letter: "+", color: "#E5484D", text: "One more life (up to 5)" },
  laser: { name: "Laser", letter: "L", color: "#F2994A", text: "Fire with Space or the Fire button for 10 seconds" },
  sticky: { name: "Sticky", letter: "G", color: "#C9A227", text: "The ball sticks to the paddle for 15 seconds; launch it when you like" },
};

export interface Prefs {
  mode: BrickMode;
  /** Phone buttons (◀ ▶ and Launch) under the board. */
  buttons: boolean;
  paddle: string;
  ball: string;
  theme: string;
  backdrop: string;
}

const PREFS_KEY = "zerosignal_brick_prefs";
export const DEFAULT_PREFS: Prefs = {
  mode: "campaign",
  buttons: false,
  paddle: "classic",
  ball: "white",
  theme: "spectrum",
  backdrop: "night",
};

export function loadPrefs(isValid: (kind: BrickItemKind, id: string) => boolean): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!v) return DEFAULT_PREFS;
    const pick = (kind: BrickItemKind) => {
      const id = v[kind];
      return typeof id === "string" && isValid(kind, id) ? id : DEFAULT_PREFS[kind];
    };
    return {
      mode: v.mode && v.mode in MODE_INFO ? v.mode : DEFAULT_PREFS.mode,
      buttons: v.buttons === true,
      paddle: pick("paddle"),
      ball: pick("ball"),
      theme: pick("theme"),
      backdrop: pick("backdrop"),
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

/** "1:05" from ms. */
export function playTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.trunc(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
