import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const checkersGame: GameModule = {
  meta: {
    id: "checkers",
    title: "Checkers",
    tagline: "Jump, crown and clear the board vs Zero-Bot or a friend.",
    tags: ["Strategy", "Classic 8×8"],
    play: ["bot", "online", "local", "daily"],
    accent: "green",
    icon: "⚫",
    status: "live",
    isNew: true,
    scoreLabel: "Points",
    boards: [
      { label: "All points" },
      { level: 5, label: "📅 Today's puzzle", period: "today" },
    ],
    tutorial: [
      {
        icon: "⚫",
        title: "Move diagonally",
        text: "Pieces move one square diagonally forward on the dark squares. Dark moves first. Click a piece, then where it goes.",
      },
      {
        icon: "💥",
        title: "Jumping is a must",
        text: "Jump over an enemy piece into the empty square behind it to take it. If you can jump, you must. Keep jumping with the same piece while you can.",
      },
      {
        icon: "♛",
        title: "Get crowned",
        text: "Reach the far row and your piece becomes a king that moves forward and backward. Leave your opponent with no move and you win.",
      },
      {
        icon: "🏆",
        title: "Pick how to play",
        text: "Beat Zero-Bot (4 levels), solve the Daily puzzle, play a friend online on another device, or pass and play on one device.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default checkersGame;
