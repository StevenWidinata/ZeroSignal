/** Link that opens a game on its Daily. */
export function dailyLink(gameId: string): string {
  if (gameId === "chess" || gameId === "checkers") return `/play/${gameId}?mode=puzzle`;
  if (gameId === "minefield") return "/play/minefield";
  return `/play/${gameId}?daily=1`;
}

/** Did we arrive with ?daily=1? */
export function wantsDaily(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get("daily") === "1";
}

/** Today's date on the WIB clock (the Daily day), e.g. "2026-11-16". */
export function wibDate(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export interface ShareInput {
  icon: string;
  title: string;
  date: string;
  /** Main result, e.g. "1,840 pts". */
  headline: string;
  /** One extra line of emoji stats. */
  detail?: string;
  rank?: number | null;
  players?: number;
  url: string;
}

/** The text a "Copy result" button puts on the clipboard. */
export function shareText(s: ShareInput): string {
  const place = s.rank && s.players ? ` · #${s.rank} of ${Math.max(s.players, s.rank)}` : "";
  return [`${s.icon} ${s.title} Daily ${s.date}`, `${s.headline}${place}`, s.detail, s.url].filter(Boolean).join("\n");
}
