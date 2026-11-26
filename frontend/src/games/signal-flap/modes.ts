import type { FlapItemKind, FlapMode } from "../../api/types";
import type { End } from "./engine";

export const END_TEXT: Record<End, string> = {
  crash: "Signal lost",
  time: "Time cap reached",
  quit: "You ended the run",
};

export const MODE_INFO: Record<FlapMode, { name: string; blurb: string }> = {
  endless: { name: "Endless", blurb: "A new course every run. Fly as far as you can." },
  daily: { name: "Daily", blurb: "Today's course, the same for everyone. One ranked try." },
};

export interface Prefs {
  mode: FlapMode;
  drone: string;
  trail: string;
  sky: string;
}

const PREFS_KEY = "zerosignal_flap_prefs";
export const DEFAULT_PREFS: Prefs = { mode: "endless", drone: "scout", trail: "none", sky: "day" };

export function loadPrefs(isValid: (kind: FlapItemKind, id: string) => boolean): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!v) return DEFAULT_PREFS;
    const pick = (kind: FlapItemKind) => {
      const id = v[kind];
      return typeof id === "string" && isValid(kind, id) ? id : DEFAULT_PREFS[kind];
    };
    return {
      mode: v.mode && v.mode in MODE_INFO ? v.mode : DEFAULT_PREFS.mode,
      drone: pick("drone"),
      trail: pick("trail"),
      sky: pick("sky"),
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
