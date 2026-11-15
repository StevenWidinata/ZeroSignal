import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const chess: GameModule = {
  meta: {
    id: "chess",
    title: "Chess",
    tagline: "Checkmate Zero-Bot, solve the daily puzzle, or play a friend online.",
    tags: ["Strategy", "vs AI", "Online", "Daily"],
    accent: "blue",
    icon: "♟️",
    status: "live",
    isNew: true,
    scoreLabel: "Points",
    boards: [
      { label: "♟️ All points" },
      { level: 5, label: "📅 Today's puzzle", period: "today" },
    ],
    tutorial: [
      {
        icon: "♟️",
        title: "Move your pieces",
        text: "Tap a piece to see where it can go (the dots), then tap a dot. You can also drag pieces. White moves first.",
      },
      {
        icon: "👑",
        title: "Checkmate wins",
        text: "Attack the enemy king so it can't escape: that's checkmate. If a player has no legal move but isn't in check, it's a draw (stalemate).",
      },
      {
        icon: "🤖",
        title: "Pick your rival",
        text: "Play Zero-Bot from Easy to Master, a friend on this device, or a friend online with a room code.",
      },
      {
        icon: "📅",
        title: "Daily puzzle",
        text: "Each day everyone gets the same mate in 2. Solve it for coins and keep your streak going. Boards and piece sets are in the shop.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default chess;
