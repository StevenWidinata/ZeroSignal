/**
 * Ping's mood, 0..5. It is saved with the settings (so it follows a
 * registered player to every device) and only changes when you see him:
 * petting raises it, and every 8 hours without any attention lowers it by
 * one, never below 1. At 1 he mopes; one pet cheers him back up.
 */

export interface PingSaved {
  mood: number;
  /** When he last got attention (ms since epoch); 0 = never. */
  at: number;
}

export const MOOD_MAX = 5;
export const MOOD_START = 4;
export const MOOD_FLOOR = 1;
/** At or below this he mopes. */
export const MOPE_AT = 1;
/** Any pet brings him back to at least this. */
export const CHEER_TO = 3;
export const DECAY_MS = 8 * 60 * 60 * 1000;
/** Clicks only re-save his "last attention" time this often (fewer account saves). */
export const TOUCH_SAVE_MS = 60 * 60 * 1000;

export const DEFAULT_PING: PingSaved = { mood: MOOD_START, at: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Clean a saved value (from storage or the account). */
export function parsePing(v: unknown): PingSaved {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_PING };
  const { mood, at } = v as Record<string, unknown>;
  return {
    mood: typeof mood === "number" && Number.isFinite(mood) ? clamp(Math.round(mood), 0, MOOD_MAX) : MOOD_START,
    at: typeof at === "number" && Number.isFinite(at) && at > 0 ? Math.floor(at) : 0,
  };
}

/** His mood right now, after any 8-hour drops since `at`. */
export function moodNow(s: PingSaved, now: number): number {
  if (!s.at || now <= s.at) return s.mood;
  const drops = Math.floor((now - s.at) / DECAY_MS);
  if (drops <= 0) return s.mood;
  // Decay never pulls him below the floor (but leaves a lower saved mood alone).
  return Math.min(s.mood, Math.max(MOOD_FLOOR, s.mood - drops));
}

export const isMoping = (mood: number) => mood <= MOPE_AT;

/** A click: no mood change, but the 8-hour clock restarts. Null = nothing worth saving. */
export function touched(s: PingSaved, now: number): PingSaved | null {
  const mood = moodNow(s, now);
  if (mood === s.mood && s.at && now - s.at < TOUCH_SAVE_MS) return null;
  return { mood, at: now };
}

/** Petted for `seconds`: +1 per full second (at least +1), and never left below CHEER_TO. */
export function petted(s: PingSaved, now: number, seconds: number): PingSaved {
  const gain = Math.max(1, Math.floor(seconds));
  return { mood: clamp(Math.max(CHEER_TO, moodNow(s, now) + gain), 0, MOOD_MAX), at: now };
}
