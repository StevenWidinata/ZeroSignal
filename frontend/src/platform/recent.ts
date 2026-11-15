/** Games played recently in this browser (newest first), for "Continue". */
const KEY = "zerosignal_recent_games";
export const RECENT_MAX = 3;

/** Old game ids -> current ones. */
const RENAMED: Record<string, string> = { "angry-bird": "sling-squad" };

export function parseRecent(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    // The slingshot game was renamed (angry-bird -> sling-squad).
    const ids = v.filter((x): x is string => typeof x === "string").map((x) => RENAMED[x] ?? x);
    return [...new Set(ids)].slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Move `id` to the front of the list. */
export function withPlayed(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

export function recentGames(): string[] {
  try {
    return parseRecent(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function recordPlayed(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(withPlayed(recentGames(), id)));
  } catch {
    /* storage may be blocked */
  }
}
