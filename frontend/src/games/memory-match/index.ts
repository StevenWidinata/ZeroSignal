import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const memoryMatch: GameModule = {
  meta: {
    id: "memory-match",
    title: "Memory Match",
    tagline: "Flip cards, find pairs, out-remember a friend. Chaos mode adds power-ups.",
    tags: ["Memory", "Power-ups"],
    play: ["online"],
    accent: "green",
    icon: "🃏",
    status: "live",
    scoreLabel: "Wins",
    tutorial: [
      {
        icon: "🃏",
        title: "Take turns flipping",
        text: "Flip 2 cards on your turn. A pair is yours and you go again; a miss turns them back and passes the turn.",
      },
      {
        icon: "🏆",
        title: "Most pairs wins",
        text: "When the board is empty, whoever found more pairs wins the game. Both of you see every card that's turned over.",
      },
      {
        icon: "⚡",
        title: "Chaos mode",
        text: "Before each game, each of you picks 3 power-ups: Shuffle, Swap, Peek, Fog and more. Each works once, one per turn.",
      },
      {
        icon: "🌐",
        title: "Play a friend",
        text: "Start a room, send the code or link, and play on two devices. Pick 4×4, 4×6 or 6×6 and best of 1, 3 or 5.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default memoryMatch;
