import { lazy } from "react";
import type { GameModule } from "../../platform/types";

/** The Campaign board stores stars × 10,000,000 + total score (see backend/src/brick_breaker/api.rs). */
export const CAMPAIGN_STAR_UNIT = 10_000_000;

const brickBreaker: GameModule = {
  meta: {
    id: "brick-breaker",
    title: "Brick Breaker",
    tagline: "Bounce the ball, smash every brick, catch the drops.",
    tags: ["Arcade", "Levels"],
    play: ["solo", "daily"],
    accent: "blue",
    icon: "🧱",
    status: "live",
    scoreLabel: "Best score",
    detailLabel: "Wave",
    boards: [
      { level: 1, label: "Endless" },
      { level: 2, label: "Campaign", scoreLabel: "Stars", detailLabel: "Total score", packed: CAMPAIGN_STAR_UNIT },
      { level: 3, label: "Today's Daily", period: "today" },
    ],
    tutorial: [
      {
        icon: "🏓",
        title: "Move the paddle",
        text: "Move the mouse over the board, drag a finger on it, or use the arrow keys. Click, tap or press Space to launch the ball.",
      },
      {
        icon: "🧱",
        title: "Know your bricks",
        text: "Tough bricks take 2 or 3 hits, steel never breaks, explosive bricks take their neighbours with them and some bricks slide.",
      },
      {
        icon: "💊",
        title: "Catch the drops",
        text: "Bricks with a colored dot hold a drop: Wide, Multi-ball, Slow, Extra life, Laser or Sticky. Catch it with the paddle.",
      },
      {
        icon: "⭐",
        title: "Campaign, Endless, Daily",
        text: "Clear 24 levels for up to 3 stars each, last as many Endless waves as you can, or take today's Daily. The server replays every run.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default brickBreaker;
