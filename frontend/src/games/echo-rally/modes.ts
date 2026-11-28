import type { RallyLevel, RallyMode } from "../../api/types";
import { kitOk, rules, type End, type Power } from "./engine";
import type { CosmeticKind } from "./items";

export const LEVELS: RallyLevel[] = ["easy", "medium", "hard", "master"];

export const LEVEL_INFO: Record<RallyLevel, { name: string; blurb: string }> = {
  easy: { name: "Easy", blurb: "Slow to react and often off target" },
  medium: { name: "Medium", blurb: "Keeps a rally going, misses fast balls" },
  hard: { name: "Hard", blurb: "Quick, accurate, hits angles on purpose" },
  master: { name: "Master", blurb: "Rarely misses and aims away from you" },
};

export const MODE_INFO: Record<RallyMode, { name: string; blurb: string }> = {
  classic: { name: "Classic", blurb: "Two paddles and a ball that speeds up with every return." },
  chaos: { name: "Chaos", blurb: "Bring 3 powers and fire each one once per match. Zero-Bot brings some too." },
};

export const END_TEXT: Record<End, string> = {
  win: "Match point",
  time: "Time cap reached",
  quit: "You left the match",
};

export const TARGETS = rules.targets as number[];

export interface Prefs {
  mode: RallyMode;
  level: RallyLevel;
  target: number;
  /** Your Chaos kit, in slot order. */
  kit: Power[];
  /** Phone buttons (up and down) under the court. */
  buttons: boolean;
  paddle: string;
  ball: string;
  court: string;
}

const PREFS_KEY = "zerosignal_rally_prefs";
export const DEFAULT_KIT: Power[] = ["grow", "smash", "shield"];
export const DEFAULT_PREFS: Prefs = {
  mode: "classic",
  level: "easy",
  target: 5,
  kit: DEFAULT_KIT,
  buttons: false,
  paddle: "classic",
  ball: "pixel",
  court: "black",
};

export function loadPrefs(isValid: (kind: CosmeticKind, id: string) => boolean): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!v) return DEFAULT_PREFS;
    const pick = (kind: CosmeticKind) => {
      const id = v[kind];
      return typeof id === "string" && isValid(kind, id) ? id : DEFAULT_PREFS[kind];
    };
    return {
      mode: v.mode && v.mode in MODE_INFO ? v.mode : DEFAULT_PREFS.mode,
      level: v.level && LEVELS.includes(v.level) ? v.level : DEFAULT_PREFS.level,
      target: typeof v.target === "number" && TARGETS.includes(v.target) ? v.target : DEFAULT_PREFS.target,
      kit: Array.isArray(v.kit) && kitOk(v.kit) ? v.kit : DEFAULT_KIT,
      buttons: v.buttons === true,
      paddle: pick("paddle"),
      ball: pick("ball"),
      court: pick("court"),
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

/** Adds a power to a kit, or takes it out; a full kit swaps out its oldest pick. */
export function toggleKit(kit: Power[], p: Power): Power[] {
  if (kit.includes(p)) return kit.filter((k) => k !== p);
  const next = [...kit, p];
  return next.length > rules.kit_size ? next.slice(next.length - rules.kit_size) : next;
}

/** "1:05" from ms. */
export function playTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.trunc(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
