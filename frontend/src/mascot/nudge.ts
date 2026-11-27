import type { NudgeKind } from "./lines";

/** Each nudge at most once an hour. */
export const NUDGE_GAP_MS = 60 * 60 * 1000;
/** Most important first. */
export const NUDGE_ORDER: NudgeKind[] = ["prize", "quests", "daily"];

/** Which nudge to say now, if any. */
export function pickNudge(
  open: Partial<Record<NudgeKind, boolean>>,
  last: Partial<Record<NudgeKind, number>>,
  now: number,
): NudgeKind | null {
  for (const k of NUDGE_ORDER) {
    if (!open[k]) continue;
    const t = last[k];
    if (typeof t === "number" && now - t < NUDGE_GAP_MS && now >= t) continue;
    return k;
  }
  return null;
}

/** No nudges here: games, sign-in pages, and the pages the nudge is about. */
export function nudgesAllowed(pathname: string): boolean {
  return !/^\/(play|login|register)(\/|$)/.test(pathname);
}

/** Drop a nudge that points at the page you're already on. */
export function relevantHere(kind: NudgeKind, pathname: string): boolean {
  if (kind === "quests") return !pathname.startsWith("/quests");
  return true;
}
