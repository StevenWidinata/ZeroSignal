import type { DailyView } from "../../api/types";

/** What the Hub row says about one Daily. */
export function dailyLine(d: DailyView): { text: string; action: "play" | "continue" | "board" } {
  if (d.status === "new") return { text: "Not played yet today", action: "play" };
  if (d.status === "playing") return { text: "In progress: finish it today", action: "continue" };
  if (d.score === null || d.score <= 0) return { text: "✓ Done for today", action: "board" };
  const place = d.rank !== null && d.players > 0 ? ` · #${d.rank} of ${Math.max(d.players, d.rank)}` : "";
  return { text: `✓ ${d.score.toLocaleString()} pts${place}`, action: "board" };
}

/** Link that opens a game on its Daily. */
export function dailyLink(gameId: string): string {
  if (gameId === "chess") return "/play/chess?mode=puzzle";
  if (gameId === "minefield") return "/play/minefield";
  return `/play/${gameId}?daily=1`;
}

/** Did we arrive with ?daily=1? */
export function wantsDaily(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get("daily") === "1";
}

/** "3 of 6 done" summary. */
export function doneCount(list: DailyView[]): string {
  return `${list.filter((d) => d.status === "done").length} of ${list.length} done`;
}
